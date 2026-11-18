// 改正案1件＝1オブジェクト（F-41〜F-43）。Yjs の同期と awareness（カーソル・在席）は y-partyserver が行う。
// - 更新は SQLite に追記し、一定数たまったら1つにまとめる（store.ts）。誰もいないときは Hibernation で止まる。
// - 接続は Worker で運営者のセッションを確かめたものだけが届く（user.ts）。15分を過ぎた接続は切り、
//   画面がつなぎ直すときに Worker が判定をやり直す（運営ロールを外すと15分以内に編集できなくなる）。
// - 文書が変わったら D1 の一覧（ルール名・更新日時・最終編集者）を更新する。
// 呼び出しは getServerByName を通すこと（onStart を済ませてから RPC が届くようにするため）。

import {
  exportProposal,
  readEntries,
  readProposal,
  readProposalMeta,
  type AmendingNumber,
  type EntryOp,
} from '@rule-builder/core';
import type { Connection, ConnectionContext, WSMessage } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { RECHECK_MS } from '../auth/session.ts';
import { COMPACT_AT, RoomStore } from './store.ts';
import { decodeUser, USER_HEADER, type RoomUser } from './user.ts';

/** 接続を切る理由（画面は REAUTH なら運営者の判定をやり直してつなぎ直す） */
export const CLOSE_REAUTH = 4001;
export const CLOSE_FORBIDDEN = 4003;

/** 改正案の状態（サーバーだけが変える。Phase 10 で発議・投票の状態を足す） */
export type RoomStatus = 'draft';

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
  amendingNumber: AmendingNumber;
  enforcementDate: string;
  entries: PublicEntry[];
  /** 投票の締切（Phase 10） */
  voteDeadline: string | null;
};

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

  status(): RoomStatus {
    return (this.store.getMeta('status') as RoomStatus | null) ?? 'draft';
  }

  /** 運営投票の開始後は全員を読み取り専用にする（Phase 10） */
  private locked(): boolean {
    return this.store.getMeta('locked') === '1';
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
    await this.scheduleRecheck();
  }

  /** いちばん早く判定が古くなる接続に合わせてアラームを置く */
  private async scheduleRecheck() {
    let earliest = Infinity;
    for (const c of this.getConnections()) {
      const user = userOf(c);
      if (user) earliest = Math.min(earliest, user.chk + RECHECK_MS);
    }
    if (earliest === Infinity) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > earliest) await this.ctx.storage.setAlarm(earliest);
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
    return {
      status: this.status(),
      amendingNumber: p.amendingNumber,
      enforcementDate: p.enforcementDate,
      voteDeadline: null,
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
