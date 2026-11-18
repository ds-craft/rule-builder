// 発議・採決・自動反映の E2E（手順書 10-9 のうち、模擬の OpsBot とメモリ上の GitHub で確かめられる部分）：
// - 発議前の確認・発議・公開リンク（ログインなしで見られる）
// - 運営投票の開始で内容が固定され、エディタが読み取り専用になる
// - 運営投票の可決 → 参加者協議の開始 → 参加者投票 → 可決 → ds-craft/rules（メモリ上）への反映
// 画面が読む公開中のルール（api.github.com・raw.githubusercontent.com）も、メモリ上の GitHub に振り向ける。
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API, GITHUB, RULES_REPO } from './ports.ts';

const A = '100000000000000001';

async function routeGitHub(context: BrowserContext) {
  await context.route(/^https:\/\/api\.github\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const res = await route.fetch({ url: `${GITHUB}${url.pathname}${url.search}` });
    await route.fulfill({ response: res });
  });
  await context.route(/^https:\/\/raw\.githubusercontent\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const rest = url.pathname.slice(`/${RULES_REPO}/`.length);
    const res = await route.fetch({ url: `${GITHUB}/raw/${rest}` });
    await route.fulfill({ response: res });
  });
}

async function login(page: Page, uid: string, ret = '/file/home') {
  await page.goto(`${API}/auth/dev-login?uid=${uid}&return=${encodeURIComponent(ret)}`);
}

/** 新しいルールを制定する改正案を作る（施行日は過去にして、可決したらすぐ反映させる） */
async function createProposal(page: Page) {
  await page.getByRole('button', { name: /新しいルールを制定/ }).click();
  const dialog = page.locator('dialog[open]');
  await dialog.locator('#nd-name').fill('発議の試しのルール');
  await dialog.locator('#nd-num').fill('91');
  await dialog.locator('#nd-date').fill('2026-07-01');
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/#\/edit\/0$/);
  // 本文を入れる（空の条は書式チェックのエラーになる）
  const para = page.locator('.rb-editor .article').first().locator('p, .tx').last();
  await para.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('このルールは、発議の試しのために定めます。');
}

test('発議から反映まで：公開リンク・読み取り専用・模擬の投票・自動反映', async ({ browser }) => {
  const context = await browser.newContext();
  await routeGitHub(context);
  const page = await context.newPage();
  await login(page, A);
  await createProposal(page);

  // 中身がサーバーの一覧に載るまで待ってから、発議ページを開く
  await expect
    .poll(async () => {
      const r = await page.request.get(`${API}/proposals`);
      const body = (await r.json()) as { proposals: { rules: { name: string }[] }[] };
      return body.proposals.some((p) => p.rules.some((x) => x.name === '発議の試しのルール'));
    })
    .toBe(true);
  await page.goto('/#/file/propose');
  await expect(page.getByRole('heading', { name: '発議前の確認' })).toBeVisible();
  await expect(page.locator('.checks li.ok')).toHaveCount(5);

  await page.getByRole('button', { name: '発議', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '発議', exact: true }).click();
  await expect(page.getByRole('heading', { name: '運営内協議' })).toBeVisible();
  await expect(page.getByLabel('運営内協議に貼る文面')).toHaveValue(/【改正案】発議の試しのルール/);
  const publicUrl = await page.locator('.public-link a').getAttribute('href');
  expect(publicUrl).toMatch(/#\/public\/[A-Za-z0-9_-]{22}$/);

  // 公開リンクはログインなしで見られる
  const anon = await browser.newContext();
  const pub = await anon.newPage();
  await pub.goto(`/#/public/${publicUrl!.split('/').pop()}`);
  await expect(pub.getByText('運営内協議中の改正案です')).toBeVisible();
  await expect(pub.getByText('このルールは、発議の試しのために定めます。')).toBeVisible();
  await anon.close();

  // 運営投票を開始すると、エディタは読み取り専用になる
  await page.getByRole('button', { name: '運営投票を開始…' }).click();
  await page.locator('dialog[open]').getByRole('button', { name: '開始' }).click();
  await expect(page.getByRole('heading', { name: '運営投票中' })).toBeVisible();
  await page.getByRole('link', { name: '編集に戻る' }).click();
  await expect(page.getByText('運営投票の開始後は内容が固定され、編集できません')).toBeVisible();
  await expect(page.getByText(/運営投票中：.* 締切/)).toBeVisible();
  await expect(page.locator('.rb-editor')).toHaveCount(0);
  await page.getByRole('button', { name: '発議の状況を見る' }).click();

  // 模擬の投票で可決 → 参加者協議 → 参加者投票 → 可決
  await page.getByRole('button', { name: '可決にする' }).click();
  await expect(page.getByLabel('会議場に貼る文面')).toHaveValue(/【参加者協議】発議の試しのルール/);
  await page.getByRole('button', { name: '参加者協議を開始' }).click();
  await expect(page.getByRole('heading', { name: '参加者協議中' })).toBeVisible();
  // E2E では参加者協議の長さを0時間にしている
  await page.getByRole('button', { name: '参加者投票を開始' }).click();
  await expect(page.getByRole('heading', { name: '参加者投票中' })).toBeVisible();
  await page.getByRole('button', { name: '可決にする' }).click();
  await expect(page.getByRole('heading', { name: '反映済み' })).toBeVisible();

  const g = (await (await page.request.get(`${GITHUB}/__fake/main`)).json()) as {
    head: { message: string; author: { name: string; date: string } };
    files: Record<string, string>;
  };
  expect(g.head.author).toMatchObject({ date: '2026-07-01T00:00:00+09:00' });
  expect(g.head.author.name).toMatch(/^令和\d+年ルール第91号$/);
  expect(g.head.message).toMatch(/^発議の試しのルール 施行\n/);
  const file = Object.entries(g.files).find(([, v]) => v.includes('発議の試しのために定めます'));
  expect(file?.[0]).toMatch(/^rules\/R\d{2}01091\.md$/);
  await context.close();
});
