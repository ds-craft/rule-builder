// 改正案1件＝1オブジェクト（F-41〜F-43）。Yjs の同期と awareness（カーソル・在席）は y-partyserver が行う。
// - 更新は SQLite に追記し、一定数たまったら1つにまとめる（store.ts）。誰もいないときは Hibernation で止まる。
// - 接続は Worker で運営者のセッションを確かめたものだけが届く（user.ts）。15分を過ぎた接続は切り、
//   画面がつなぎ直すときに Worker が判定をやり直す（運営ロールを外すと15分以内に編集できなくなる）。
// - 文書が変わったら D1 の一覧（ルール名・更新日時・最終編集者）を更新する。
// - 発議・採決・自動反映の手続（flow/controller.ts）もここで動かす。同じ改正案への操作は1つずつ処理される。
//   状態が変わったら、つながっている画面に独自メッセージ（flow）で知らせる。時刻で進める処理はアラームで行う。
// 呼び出しは getServerByName を通すこと（onStart を済ませてから RPC が届くようにするため）。

import {
  exportProposal,
  readEntries,
  readProposal,
  readProposalMeta,
  updateProposalMeta,
  updateRuleMeta,
  type AmendingNumber,
  type EntryOp,
  type ProposalStatus,
} from '@rule-builder/core';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { RECHECK_MS } from '../auth/session.ts';
import { FlowController } from '../flow/controller.ts';
import type { FlowActor, FlowResult, FlowView } from '../flow/state.ts';
import { rulesRepo } from '../github/client.ts';
import { proposalRpc } from '../opsbot/client.ts';
import { COMPACT_AT, RoomStore } from './store.ts';
import { decodeUser, USER_HEADER, type RoomUser } from './user.ts';

/** 接続を切る理由（画面は REAUTH なら運営者の判定をやり直してつなぎ直す） */
export const CLOSE_REAUTH = 4001;
export const CLOSE_FORBIDDEN = 4003;

/** 改正案の状態（サーバーだけが変える） */
export type RoomStatus = ProposalStatus;

export type PublicEntry = {
  op: EntryOp;
  ruleId: string;
  name: string;
  /** 改正前（制定は空） */
  baseMarkdown: string;
  /** 改正後（廃止は rules/repealed/ に移したもの） */
  markdown: string;
};

export type PublicView = {
  status: RoomStatus;
  /** 題名（件名から「施行」を除いたもの） */
  title: string;
  amendingNumber: AmendingNumber;
  enforcementDate: string;
  entries: PublicEntry[];
  /** 進行中の投票の締切 */
  voteDeadline: string | null;
  /** 参加者投票を始められるようになる時刻（参加者協議の開始の記録後） */
  participantVoteAvailableAt: string | null;
  /** 反映後のポータルのページ */
  portalUrl: string | null;
};

/** 画面への独自メッセージ（y-partyserver の custom message）。画面は受け取ったら発議の状況を読み直す */
export type FlowMessage = { type: 'flow'; status: RoomStatus; locked: boolean };

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const userOf = (c: Connection | null | undefined): RoomUser | null =>
  (c?.state as RoomUser | null | undefined) ?? null;

export class ProposalRoom extends YServer {
  static override options = { hibernate: true };
  static override callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000 };

  private store!: RoomStore;
  /** 最後に文書を変えた人（D1 の一覧の最終編集者） */
  private lastEditor: string | null = null;

  override async onLoad() {
    this.store = new RoomStore(this.ctx.storage.sql, (f) => this.ctx.storage.transactionSync(f));
    for (const u of this.store.load()) Y.applyUpdate(this.document, u);
    // 読み込んだ後に付ける（読み込んだ分を書き直さないため）
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      const n = this.store.append(update);
      if (n >= COMPACT_AT) this.store.replaceAll(Y.encodeStateAsUpdate(this.document));
      const user = userOf(origin as Connection);
      if (user) this.lastEditor = user.uid;
    });
  }

  /** 文書が変わって少し待ったら呼ばれる（y-partyserver が間引く） */
  override async onSave() {
    await this.syncListing();
  }

  /** 手続（呼ぶたびに room_meta から読み直す） */
  private flow(): FlowController {
    const env = this.env;
    return new FlowController({
      id: this.name,
      appOrigin: env.APP_ORIGIN,
      portalOrigin: env.PORTAL_ORIGIN,
      db: env.DB,
      rpc: proposalRpc(env),
      repo: rulesRepo(env),
      now: () => Date.now(),
      getMeta: (k) => this.store.getMeta(k),
      setMeta: (k, v) => this.store.setMeta(k, v),
      readProposal: () => readProposal(this.document),
      renumberDocument: (next) => this.renumberDocument(next),
      broadcast: (view) => {
        const msg: FlowMessage = { type: 'flow', status: view.status, locked: view.locked };
        this.broadcastCustomMessage(JSON.stringify(msg));
      },
      randomId: () => base64url(crypto.getRandomValues(new Uint8Array(16))),
    });
  }

  status(): RoomStatus {
    return this.flow().status();
  }

  /** 運営投票の開始後は全員を読み取り専用にする */
  private locked(): boolean {
    return this.store.getMeta('locked') === '1';
  }

  /** 可決後に改正ルール番号が変わったとき、文書の番号も直す（読み取り専用の間もサーバーは書ける） */
  private renumberDocument(next: AmendingNumber) {
    const prev = readProposalMeta(this.document).amendingNumber;
    this.document.transact(() => {
      for (const e of readEntries(this.document)) {
        const m = e.meta;
        if (
          e.op === 'create' &&
          m.kind === prev.kind &&
          m.year === prev.year &&
          m.number === prev.number
        ) {
          updateRuleMeta(this.document, e.entryId, { number: next.number });
        }
      }
      updateProposalMeta(this.document, { amendingNumber: next });
    });
  }

  override isReadOnly(connection: Connection): boolean {
    return this.locked() || userOf(connection)?.readOnly !== false;
  }

  override async onConnect(connection: Connection, ctx: ConnectionContext) {
    const user = decodeUser(ctx.request.headers.get(USER_HEADER));
    if (!user) {
      connection.close(CLOSE_FORBIDDEN, 'forbidden');
      return;
    }
    connection.setState(user);
    await super.onConnect(connection, ctx);
    await this.scheduleRecheck();
  }

  override onMessage(connection: Connection, message: WSMessage) {
    const user = userOf(connection);
    if (!user || Date.now() - user.chk >= RECHECK_MS) {
      connection.close(CLOSE_REAUTH, 'reauth');
      return;
    }
    return super.onMessage(connection, message);
  }

  override async onAlarm() {
    const now = Date.now();
    for (const c of this.getConnections()) {
      const user = userOf(c);
      if (!user || now - user.chk >= RECHECK_MS) c.close(CLOSE_REAUTH, 'reauth');
    }
    const flow = this.flow();
    if (flow.nextAt !== null && flow.nextAt <= now) {
      await flow
        .tick()
        .catch((e) => console.error(`改正案 ${this.name} の手続を進められませんでした`, e));
    }
    await this.scheduleAlarm();
  }

  /** いちばん早い予定（接続の判定が古くなる・手続を進める）に合わせてアラームを置く */
  private async scheduleAlarm() {
    let earliest = Infinity;
    for (const c of this.getConnections()) {
      const user = userOf(c);
      if (user) earliest = Math.min(earliest, user.chk + RECHECK_MS);
    }
    const next = this.flow().nextAt;
    if (next !== null) earliest = Math.min(earliest, next);
    if (earliest === Infinity) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > earliest) await this.ctx.storage.setAlarm(earliest);
  }

  private async scheduleRecheck() {
    await this.scheduleAlarm();
  }

  // ---------- 発議・採決（Worker の flow/routes.ts から呼ぶ） ----------

  private async after(r: FlowResult): Promise<FlowResult> {
    await this.scheduleAlarm();
    return r;
  }

  async flowView(refresh = true): Promise<FlowView> {
    const view = await this.flow().view(refresh);
    await this.scheduleAlarm();
    return view;
  }

  async flowPreflight(refsRemaining: number) {
    return this.flow().preflight(refsRemaining);
  }

  async flowSubmit(actor: FlowActor, refsRemaining: number) {
    return this.after(await this.flow().submit(actor, refsRemaining));
  }

  async flowStartModVote(actor: FlowActor, method: 'secret' | 'quick', quickConfirmed: boolean) {
    return this.after(await this.flow().startModVote(actor, method, quickConfirmed));
  }

  async flowRecordParticipantDiscussion(actor: FlowActor, startedAt: string) {
    return this.after(await this.flow().recordParticipantDiscussion(actor, startedAt));
  }

  async flowStartParticipantVote(actor: FlowActor) {
    return this.after(await this.flow().startParticipantVote(actor));
  }

  async flowWithdraw(actor: FlowActor) {
    return this.after(await this.flow().withdraw(actor));
  }

  async flowSimDecide(actor: FlowActor, passed: boolean) {
    return this.after(await this.flow().simDecide(actor, passed));
  }

  async flowRetryReflect(actor: FlowActor) {
    return this.after(await this.flow().retryReflect(actor));
  }

  /** D1 の一覧を文書に合わせる。初めて中身が届いたときに行を作る */
  async syncListing(now = new Date()) {
    const meta = readProposalMeta(this.document);
    const by = this.lastEditor;
    if (!meta.id || meta.id !== this.name || !by) return;
    const rules = JSON.stringify(
      readEntries(this.document).map((e) => ({ name: e.meta.name, op: e.op })),
    );
    const at = now.toISOString();
    const a = meta.amendingNumber;
    const db = this.env.DB;
    const inserted = await db
      .prepare(
        `INSERT INTO proposals (id, amending_kind, amending_year, amending_number, enforcement_date, rules,
           status, created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .bind(
        meta.id,
        a.kind,
        a.year,
        a.number,
        meta.enforcementDate,
        rules,
        this.status(),
        at,
        by,
        at,
        by,
      )
      .run();
    if (inserted.meta.changes > 0) {
      await db
        .prepare('INSERT INTO audit_log (at, actor, action, target) VALUES (?, ?, ?, ?)')
        .bind(at, by, 'proposal_created', meta.id)
        .run();
      return;
    }
    await db
      .prepare(
        `UPDATE proposals SET amending_kind = ?, amending_year = ?, amending_number = ?, enforcement_date = ?,
           rules = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      )
      .bind(a.kind, a.year, a.number, meta.enforcementDate, rules, at, by, meta.id)
      .run();
  }

  /** 公開リンクで見せる中身（編集者名やカーソルは含めない） */
  async publicView(): Promise<PublicView> {
    const p = readProposal(this.document);
    const ex = exportProposal(p);
    const out = new Map(ex.files.map((f) => [f.entryId, f]));
    const view = await this.flow().view(false);
    const o = view.opsbot;
    const vote = [o?.participantVote, o?.modVote].find((v) => v?.status === 'open');
    return {
      status: view.status,
      title: view.title || FlowController.titleOf(p),
      amendingNumber: p.amendingNumber,
      enforcementDate: p.enforcementDate,
      voteDeadline: vote?.closesAt ?? null,
      participantVoteAvailableAt:
        view.status === 'participant_discussion' ? (o?.participantVoteAvailableAt ?? null) : null,
      portalUrl: view.reflect?.portalUrl ?? null,
      entries: p.entries.map((e): PublicEntry => {
        const file = out.get(e.entryId);
        const base = e.op === 'create' ? '' : e.baseMarkdown;
        return {
          op: e.op,
          ruleId: file?.ruleId ?? (e.op === 'create' ? '' : e.ruleId),
          name: file?.name ?? (e.op === 'repeal' ? '' : e.doc.meta.name),
          baseMarkdown: base,
          markdown: file?.content ?? base,
        };
      }),
    };
  }
}
