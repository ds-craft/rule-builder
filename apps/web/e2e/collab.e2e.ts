// 共同編集の E2E（Phase 9 の完了条件）：
// - 運営者2人が別々のブラウザで同じ改正案を開き、同時に入力しても内容が失われず、互いのカーソルが見える
// - 運営者以外はログインできず、下書きを開けない
// - 通信を切って編集し、つなぎ直すと内容が合わさる
import { expect, test, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { API } from './ports.ts';

const A = '100000000000000001';
const B = '100000000000000002';
/** 開発用の OpsBot の代わりが運営者として扱わない ID（apps/server/dev/opsbot-stub/wrangler.jsonc） */
const NOT_UNEI = '100000000000000099';
/** 開発用の OpsBot の代わりが返す名前 */
const nameOf = (uid: string) => `開発用 ${uid.slice(-4)}`;

/** Discord を通さずにログインし、return の場所に戻る（サーバーの /auth/dev-login） */
async function login(page: Page, uid: string, ret = '/file/home') {
  await page.goto(`${API}/auth/dev-login?uid=${uid}&return=${encodeURIComponent(ret)}`);
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  return context.newPage();
}

/** A が新しいルールの改正案を作り、その ID を返す */
async function createProposal(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: /新しいルールを制定/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.locator('#nd-name').fill(name);
  await dialog.locator('#nd-num').fill('90');
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/#\/edit\/0$/);
  await page.getByRole('button', { name: '共有', exact: true }).click();
  const url = await page.getByRole('textbox', { name: '改正案のリンク' }).inputValue();
  await page.locator('dialog[open]').getByRole('button', { name: '閉じる' }).last().click();
  const id = /#\/p\/([0-9a-f-]{36})$/.exec(url)?.[1];
  expect(id).toBeTruthy();
  return id!;
}

/** 紙面の第1条の本文の末尾に文字を入れる */
async function typeInFirstArticle(page: Page, text: string) {
  const para = page.locator('.rb-editor .article').first().locator('p, .tx').last();
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(text);
}

/** 紙面の文字（ほかの人のカーソルの名前の札は除く） */
const editorText = (page: Page) =>
  page.locator('.rb-editor').evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('.collaboration-carets__caret').forEach((c) => c.remove());
    return copy.textContent ?? '';
  });

/**
 * 同期の WebSocket を横取りして、通信を切ったりつないだりする
 * （Chromium の setOffline では、つながっている WebSocket は切れないため）
 */
async function controllableSync(page: Page) {
  let offline = false;
  const open = new Set<WebSocketRoute>();
  await page.routeWebSocket(/\/proposals\/[^/]+\/sync/, (ws) => {
    if (offline) {
      void ws.close({ code: 1001, reason: 'offline' });
      return;
    }
    ws.connectToServer();
    open.add(ws);
    ws.onClose(() => open.delete(ws));
  });
  return {
    async setOffline(v: boolean) {
      offline = v;
      await page.context().setOffline(v);
      if (v) for (const ws of [...open]) await ws.close({ code: 1001, reason: 'offline' });
    },
  };
}

test('2人が同じ改正案を開き、同時に入力しても内容が失われず、互いのカーソルが見える', async ({
  browser,
}) => {
  const pa = await newPage(browser);
  const pb = await newPage(browser);
  await login(pa, A);
  await expect(pa.getByRole('heading', { name: new RegExp(`${nameOf(A)}さん`) })).toBeVisible();
  const id = await createProposal(pa, '共同編集のルール');

  // B は共有リンクから開く
  await login(pb, B, `/p/${id}`);
  await pb.waitForURL(/#\/edit\/0$/);
  await expect(pb.locator('.rb-editor')).toBeVisible();

  // 同時に入力する
  await Promise.all([typeInFirstArticle(pa, 'Aの入力'), typeInFirstArticle(pb, 'Bの入力')]);
  for (const p of [pa, pb]) {
    await expect.poll(() => editorText(p)).toContain('Aの入力');
    await expect.poll(() => editorText(p)).toContain('Bの入力');
  }
  expect(await editorText(pa)).toBe(await editorText(pb));

  // 互いのカーソル（名前の札）と、タイトルバーの在席が見える
  await expect(pa.locator('.collaboration-carets__label', { hasText: nameOf(B) })).toBeVisible();
  await expect(pb.locator('.collaboration-carets__label', { hasText: nameOf(A) })).toBeVisible();
  await expect(pa.getByRole('button', { name: `${nameOf(B)}のカーソルへ移動` })).toBeVisible();

  // サーバーの一覧（運営の改正案）にも出る（サーバーは編集から少し遅れて記録する）
  await expect
    .poll(
      async () => {
        const res = await pb.request.get(`${API}/proposals`);
        const body = (await res.json()) as { proposals: { id: string }[] };
        return body.proposals.some((p) => p.id === id);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await pb.goto('/#/file/open');
  await expect(pb.getByRole('cell', { name: /共同編集のルール/ }).first()).toBeVisible();
});

test('通信を切って編集し、つなぎ直すと内容が合わさる', async ({ browser }) => {
  const pa = await newPage(browser);
  const pb = await newPage(browser);
  await login(pa, A);
  const id = await createProposal(pa, 'オフラインのルール');
  const net = await controllableSync(pb);
  await login(pb, B, `/p/${id}`);
  await pb.waitForURL(/#\/edit\/0$/);
  await expect(pb.locator('.rb-editor')).toBeVisible();
  await expect(pa.getByRole('button', { name: `${nameOf(B)}のカーソルへ移動` })).toBeVisible();

  await net.setOffline(true);
  await expect(pb.locator('.titlebar .save')).toContainText('オフライン');
  await typeInFirstArticle(pb, 'オフライン中の入力');
  await typeInFirstArticle(pa, 'その間のAの入力');
  await pa.waitForTimeout(1000);
  expect(await editorText(pa)).not.toContain('オフライン中の入力');

  await net.setOffline(false);
  for (const p of [pa, pb]) {
    await expect.poll(() => editorText(p), { timeout: 30_000 }).toContain('オフライン中の入力');
    await expect.poll(() => editorText(p), { timeout: 30_000 }).toContain('その間のAの入力');
  }
  await expect(pb.locator('.titlebar .save')).toContainText('保存済み');
});

test('運営者以外はログインできず、共有リンクを開いても下書きは見えない', async ({ browser }) => {
  const pa = await newPage(browser);
  await login(pa, A);
  const id = await createProposal(pa, '運営者だけのルール');

  const other = await newPage(browser);
  await login(other, NOT_UNEI, `/p/${id}`);
  await expect(other.getByText(/運営者のロールが確認できなかったため/)).toBeVisible();
  await expect(other.getByRole('button', { name: 'Discord でログイン' })).toBeVisible();

  // ログインしていない人が共有リンクを開いても、ログインを求めるだけ
  const anon = await newPage(browser);
  await anon.goto(`/#/p/${id}`);
  await expect(anon.getByText('共有された改正案を開くには、ログインしてください。')).toBeVisible();
  await expect(anon.locator('.rb-editor')).toHaveCount(0);
  // サーバーも、ログインしていなければ一覧を返さない
  const res = await anon.request.get(`${API}/proposals`);
  expect(res.status()).toBe(401);
});
