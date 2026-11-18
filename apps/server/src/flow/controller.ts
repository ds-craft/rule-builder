// 発議・採決・自動反映の手続（手順書 Phase 10）。改正案1件ごとに ProposalRoom（Durable Object）の中で動くので、
// 同じ改正案への操作は1つずつ処理される（二重押し・集計との競合で状態が飛ばない）。
//
// 手続の記録の正は OpsBot（rule_proposals）。ここでは OpsBot の結果を写して画面と D1 の一覧に出し、
// 投票中は OpsBot に結果を問い合わせ、可決したら ds-craft/rules に反映する。状態を変えるのはサーバーだけ。
//
//   draft ─発議→ unei_discussion ─運営投票を開始（内容を固定）→ mod_vote ─集計→ participant_discussion ／ rejected
//   participant_discussion ─参加者協議を開始（記録）→ 24時間後に参加者投票を開始 → participant_vote ─集計→ passed ／ rejected
//   passed ─番号の確定 →（施行日が未来なら pending/ に置いて施行日の0時を待つ）→ 反映 → enacted
//   可決より前なら取り下げで draft に戻る（公開リンクは止め、進行中の投票は OpsBot が打ち切る）

import {
  enforcementInstant,
  exportProposal,
  formatRuleId,
  formatRuleNumber,
  isEditable,
  isFutureEnforcement,
  isProposalStatus,
  isoToWareki,
  renumberProposal,
  contentHash,
  defaultSubject,
  type AmendingNumber,
  type Proposal,
  type ProposalStatus,
} from '@rule-builder/core';
import type { RulesRepo } from '../github/client.ts';
import type { ProposalRpc } from '../opsbot/client.ts';
import type { RuleProposalResult, RuleProposalState, RuleProposalStatus } from '../opsbot/types.ts';
import { preflight, readRemoteRules } from './checks.ts';
import {
  build,
  closeDraftPull,
  changedBases,
  commitCleanup,
  commitEnactment,
  commitPending,
  nextFreeNumber,
  openDraftPull,
  usedNumbers,
} from './reflect.ts';
import {
  emptyFlow,
  type FlowActor,
  type FlowError,
  type FlowResult,
  type FlowState,
  type FlowView,
  type ReflectState,
} from './state.ts';

/** 投票中に結果を問い合わせる間隔（締切まで）と、締切を過ぎてから（OpsBot の締切処理は10分ごと） */
export const POLL_BEFORE_CLOSE_MS = 10 * 60_000;
export const POLL_AFTER_CLOSE_MS = 2 * 60_000;
/** 画面を開いたときに問い合わせ直す最短の間隔 */
export const VIEW_REFRESH_MS = 15_000;
/** 反映の再試行の間隔（続けて失敗した回数ごと）。5回続いたら運営者に知らせる */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export const NOTIFY_AFTER_FAILURES = 5;

export interface FlowHost {
  /** 改正案 ID */
  readonly id: string;
  readonly appOrigin: string;
  readonly portalOrigin: string;
  readonly db: D1Database;
  readonly rpc: ProposalRpc;
  readonly repo: RulesRepo;
  now(): number;
  getMeta(key: string): string | null;
  setMeta(key: string, value: string): void;
  /** いまの文書（Yjs）を改正案として読む */
  readProposal(): Proposal;
  /** 可決後に番号を付け替えたとき、文書の改正ルール番号（と同じ番号で制定するルールの番号）を直す */
  renumberDocument(next: AmendingNumber): void;
  /** 手続の状態が変わったことを、つながっている画面に知らせる */
  broadcast(view: FlowView): void;
  /** 128ビットの乱数（公開リンクの ID） */
  randomId(): string;
}

const STATE_TO_STATUS: Record<RuleProposalState, ProposalStatus> = {
  unei_discussion: 'unei_discussion',
  mod_vote: 'mod_vote',
  participant_discussion: 'participant_discussion',
  participant_vote: 'participant_vote',
  passed: 'passed',
  enacted: 'enacted',
  rejected: 'rejected',
  withdrawn: 'draft',
};

const fail = (
  error: FlowError['error'],
  message: string,
  extra: Partial<FlowError> = {},
): FlowResult => ({
  ok: false,
  error,
  message,
  ...extra,
});

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class FlowController {
  private readonly h: FlowHost;
  private flow: FlowState;

  constructor(host: FlowHost) {
    this.h = host;
    const raw = host.getMeta('flow');
    this.flow = raw ? { ...emptyFlow(), ...(JSON.parse(raw) as Partial<FlowState>) } : emptyFlow();
  }

  // ---------- 状態 ----------

  status(): ProposalStatus {
    const s = this.h.getMeta('status');
    return isProposalStatus(s) ? s : 'draft';
  }

  /** 運営投票の開始後は全員を読み取り専用にする */
  locked(): boolean {
    return this.h.getMeta('locked') === '1';
  }

  get nextAt(): number | null {
    return this.flow.nextAt;
  }

  private publicUrl(): string | null {
    return this.flow.publicId ? `${this.h.appOrigin}/#/public/${this.flow.publicId}` : null;
  }

  private async setStatus(next: ProposalStatus) {
    this.h.setMeta('status', next);
    this.h.setMeta('locked', isEditable(next) ? '0' : '1');
    await this.h.db
      .prepare('UPDATE proposals SET status = ?, public_id = ?, title = ? WHERE id = ?')
      .bind(next, next === 'draft' ? null : this.flow.publicId, this.flow.title, this.h.id)
      .run();
  }

  private async audit(actor: string, action: string, detail: unknown = null) {
    await this.h.db
      .prepare('INSERT INTO audit_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(
        new Date(this.h.now()).toISOString(),
        actor,
        action,
        this.h.id,
        detail == null ? null : JSON.stringify(detail),
      )
      .run();
  }

  private async frozen(): Promise<{
    at: string;
    by: string;
    contentHash: string;
    proposal: Proposal;
  } | null> {
    const row = await this.h.db
      .prepare(
        'SELECT frozen_at, frozen_by, content_hash, proposal FROM proposal_freezes WHERE proposal_id = ?',
      )
      .bind(this.h.id)
      .first<{ frozen_at: string; frozen_by: string; content_hash: string; proposal: string }>();
    if (!row) return null;
    return {
      at: row.frozen_at,
      by: row.frozen_by,
      contentHash: row.content_hash,
      proposal: JSON.parse(row.proposal) as Proposal,
    };
  }

  /** 次に手続を進める時刻を決めて保存し、画面に知らせる */
  private async save(): Promise<FlowView> {
    this.flow.nextAt = this.computeNextAt();
    this.h.setMeta('flow', JSON.stringify(this.flow));
    const view = await this.view(false);
    this.h.broadcast(view);
    return view;
  }

  private computeNextAt(): number | null {
    const now = this.h.now();
    const times: number[] = [];
    const status = this.status();
    if (status === 'mod_vote' || status === 'participant_vote') {
      const v =
        status === 'mod_vote' ? this.flow.opsbot?.modVote : this.flow.opsbot?.participantVote;
      const closes = v ? Date.parse(v.closesAt) : NaN;
      if (v?.status === 'open' && Number.isFinite(closes) && now < closes) {
        times.push(Math.min(now + POLL_BEFORE_CLOSE_MS, closes + 60_000));
      } else times.push(now + POLL_AFTER_CLOSE_MS);
    }
    if (this.flow.prTodo) times.push(this.flow.prAt ?? now);
    const r = this.flow.reflect;
    if (status === 'passed' && r) {
      if (r.stage === 'waiting') times.push(enforcementInstant(r.enforcementDate));
      else if (r.stage !== 'done' && r.stage !== 'blocked') times.push(r.retryAt ?? now);
    }
    const valid = times.filter((t) => Number.isFinite(t));
    return valid.length ? Math.min(...valid) : null;
  }

  private retryDelay(attempts: number) {
    return RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length) - 1] ?? RETRY_DELAYS_MS[0]!;
  }

  async view(refresh: boolean): Promise<FlowView> {
    if (refresh) await this.refreshFromOpsbot(false);
    const frozen = await this.frozen();
    const r = this.flow.reflect;
    return {
      status: this.status(),
      locked: this.locked(),
      title: this.flow.title,
      publicUrl: this.status() === 'draft' ? null : this.publicUrl(),
      simulated: this.h.rpc.simulated === true,
      opsbot: this.flow.opsbot,
      frozen: frozen ? { at: frozen.at, by: frozen.by, contentHash: frozen.contentHash } : null,
      pr: this.flow.pr,
      reflect: r
        ? {
            stage: r.stage,
            finalNumber: r.finalNumber,
            amendingId: r.amendingId,
            enforcementDate: r.enforcementDate,
            pendingSha: r.pendingSha,
            enactSha: r.enactSha,
            cleanupSha: r.cleanupSha,
            attempts: r.attempts,
            lastError: r.lastError,
            blocked: r.blocked,
            portalUrl: r.portalUrl,
            nextAttemptAt: r.retryAt ? new Date(r.retryAt).toISOString() : null,
          }
        : null,
      rulesRepo: this.h.repo.repo,
      polledAt: this.flow.polledAt ? new Date(this.flow.polledAt).toISOString() : null,
    };
  }

  // ---------- OpsBot ----------

  /** OpsBot の記録を写す。状態が変わったら、それに合わせた後始末をする */
  private async applyOpsbot(s: RuleProposalStatus) {
    this.flow.opsbot = s;
    this.flow.polledAt = this.h.now();
    const current = this.status();
    const target = STATE_TO_STATUS[s.state];
    // 可決後は反映の段階をこちらで進める（OpsBot の enacted は反映の告知で付く）
    const keep =
      (current === 'passed' || current === 'enacted') &&
      (target === 'passed' || target === 'enacted');
    if (!keep && target !== current) {
      if (target === 'draft') {
        this.flow.prTodo = this.flow.pr || current !== 'unei_discussion' ? 'close' : null;
        this.flow.prAt = null;
        this.flow.reflect = null;
      }
      if (target === 'passed') this.flow.reflect = this.initialReflect();
      await this.setStatus(target);
      await this.audit('system', 'proposal_status_changed', { from: current, to: target });
    }
    const v =
      s.state === 'mod_vote'
        ? s.modVote
        : s.state === 'participant_vote'
          ? s.participantVote
          : null;
    await this.h.db
      .prepare('UPDATE proposals SET vote_closes_at = ? WHERE id = ?')
      .bind(v?.status === 'open' ? v.closesAt : null, this.h.id)
      .run();
  }

  private initialReflect(): ReflectState {
    return {
      stage: 'number',
      finalNumber: null,
      amendingId: null,
      enforcementDate: this.h.readProposal().enforcementDate,
      pendingSha: null,
      enactSha: null,
      cleanupSha: null,
      attempts: 0,
      lastError: null,
      retryAt: null,
      notifiedFailure: false,
      blocked: null,
      portalUrl: null,
    };
  }

  /** 投票中などに OpsBot へ問い合わせる（force でなければ、直前に問い合わせていれば省く） */
  private async refreshFromOpsbot(force: boolean) {
    const status = this.status();
    if (status === 'draft') return;
    if (!force && this.h.now() - this.flow.polledAt < VIEW_REFRESH_MS) return;
    try {
      const s = await this.h.rpc.getProposalStatus(this.h.id);
      if (s) await this.applyOpsbot(s);
    } catch (e) {
      console.error('OpsBot に手続の状態を問い合わせられませんでした', e);
    }
    this.flow.nextAt = this.computeNextAt();
    this.h.setMeta('flow', JSON.stringify(this.flow));
  }

  /** OpsBot の応答を画面の結果にする（断られたときも、OpsBot の記録に合わせ直す） */
  private async fromRpc(r: RuleProposalResult): Promise<FlowResult | null> {
    if (r.status) await this.applyOpsbot(r.status);
    if (r.ok) return null;
    const map: Record<string, FlowError['error']> = {
      not_unei: 'forbidden',
      bad_state: 'conflict',
      too_early: 'conflict',
      not_found: 'conflict',
      bad_request: 'bad_request',
      vote_failed: 'unavailable',
    };
    await this.save();
    return fail(map[r.code] ?? 'unavailable', r.message);
  }

  /**
   * OpsBot を呼び、断られたら画面の結果にする（OpsBot の記録には合わせ直す）。
   * 受け付けられたら null、断られた・呼べなかったら FlowResult。
   */
  private async call(f: () => Promise<RuleProposalResult>): Promise<FlowResult | null> {
    let r: RuleProposalResult;
    try {
      r = await f();
    } catch (e) {
      console.error('OpsBot の呼び出しに失敗しました', e);
      return fail(
        'unavailable',
        'OpsBot に問い合わせられませんでした。しばらくしてからやり直してください',
      );
    }
    return this.fromRpc(r);
  }

  // ---------- 発議（F-50・F-51） ----------

  /** 題名：件名の既定値から「施行」を除いたもの（「基本ルールの一部を改正するルール」） */
  static titleOf(p: Proposal): string {
    return defaultSubject(p).replace(/\s*施行$/, '');
  }

  async preflight(refsRemaining: number) {
    const p = this.h.readProposal();
    const remote = await readRemoteRules(this.h.repo);
    return preflight(p, remote, refsRemaining);
  }

  async submit(actor: FlowActor, refsRemaining: number): Promise<FlowResult> {
    if (this.status() !== 'draft') return fail('conflict', 'この改正案はすでに発議されています');
    const p = this.h.readProposal();
    if (p.id !== this.h.id) return fail('conflict', '改正案がまだサーバーに保存されていません');
    let checks;
    try {
      checks = await this.preflight(refsRemaining);
    } catch (e) {
      console.error(e);
      return fail('unavailable', `公開中のルールを読めませんでした（${errorText(e)}）`);
    }
    if (checks.some((c) => !c.ok)) {
      return fail('bad_request', '発議前の確認を満たしていない項目があります', { checks });
    }
    const listed = await this.h.db
      .prepare('SELECT 1 FROM proposals WHERE id = ?')
      .bind(this.h.id)
      .first();
    if (!listed) return fail('conflict', '改正案がまだサーバーに保存されていません');

    // 取り下げて発議し直すときは、前の公開リンクを使わない
    this.flow.publicId = this.h.randomId();
    this.flow.title = FlowController.titleOf(p);
    const err = await this.call(() =>
      this.h.rpc.submitProposal({
        proposalId: this.h.id,
        title: this.flow.title,
        provisionalNumber: formatRuleNumber(p.amendingNumber),
        proposedBy: actor.uid,
        publicUrl: this.publicUrl()!,
      }),
    );
    if (err) {
      if (this.status() === 'draft') this.flow.publicId = null;
      this.h.setMeta('flow', JSON.stringify(this.flow));
      return err;
    }
    await this.audit(actor.uid, 'proposal_submitted', { title: this.flow.title });
    return { ok: true, view: await this.save() };
  }

  // ---------- 運営投票（F-52） ----------

  async startModVote(
    actor: FlowActor,
    method: 'secret' | 'quick',
    quickConfirmed: boolean,
  ): Promise<FlowResult> {
    if (method !== 'secret' && method !== 'quick')
      return fail('bad_request', '投票の方式が正しくありません');
    if (method === 'quick' && !quickConfirmed) {
      return fail(
        'bad_request',
        '短縮投票では、同時会議で全運営者が同意したことを確かめてください',
      );
    }
    if (this.status() !== 'unei_discussion')
      return fail('conflict', '運営内協議中の改正案だけ運営投票を開始できます');

    // 先に固定して、これ以降に届いた編集は捨てる
    this.h.setMeta('locked', '1');
    const p = this.h.readProposal();
    const ex = exportProposal(p);
    const hash = await contentHash(p, ex);
    const baseShas = Object.fromEntries(
      p.entries
        .filter((e) => e.op !== 'create')
        .map((e) => [
          `rules/${(e as { ruleId: string }).ruleId}.md`,
          (e as { baseSha: string }).baseSha,
        ]),
    );
    await this.h.db
      .prepare(
        `INSERT INTO proposal_freezes (proposal_id, frozen_at, frozen_by, content_hash, proposal, base_shas)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id) DO UPDATE SET frozen_at = excluded.frozen_at, frozen_by = excluded.frozen_by,
           content_hash = excluded.content_hash, proposal = excluded.proposal, base_shas = excluded.base_shas`,
      )
      .bind(
        this.h.id,
        new Date(this.h.now()).toISOString(),
        actor.uid,
        hash,
        JSON.stringify(p),
        JSON.stringify(baseShas),
      )
      .run();

    const err = await this.call(() =>
      this.h.rpc.startModVote({
        proposalId: this.h.id,
        method,
        startedBy: actor.uid,
        publicUrl: this.publicUrl()!,
        contentHash: hash,
      }),
    );
    if (err) {
      // 投票を始められなかったら固定を解く（OpsBot の記録は運営内協議のまま）
      if (this.status() === 'unei_discussion') this.h.setMeta('locked', '0');
      this.h.setMeta('flow', JSON.stringify(this.flow));
      const view = await this.view(false);
      this.h.broadcast(view);
      return err;
    }
    this.flow.prTodo = 'open';
    this.flow.prAt = null;
    await this.audit(actor.uid, 'proposal_mod_vote_started', { method, contentHash: hash });
    return { ok: true, view: await this.save() };
  }

  // ---------- 参加者協議・参加者投票（F-53・F-54） ----------

  async recordParticipantDiscussion(actor: FlowActor, startedAt: string): Promise<FlowResult> {
    if (this.status() !== 'participant_discussion') {
      return fail('conflict', '参加者協議の段階の改正案だけ開始を記録できます');
    }
    const err = await this.call(() =>
      this.h.rpc.recordParticipantDiscussion({
        proposalId: this.h.id,
        startedBy: actor.uid,
        startedAt,
      }),
    );
    if (err) return err;
    await this.audit(actor.uid, 'proposal_participant_discussion_recorded', { startedAt });
    return { ok: true, view: await this.save() };
  }

  async startParticipantVote(actor: FlowActor): Promise<FlowResult> {
    if (this.status() !== 'participant_discussion') {
      return fail('conflict', '参加者協議の段階の改正案だけ参加者投票を開始できます');
    }
    const err = await this.call(() =>
      this.h.rpc.startParticipantVote({ proposalId: this.h.id, startedBy: actor.uid }),
    );
    if (err) return err;
    await this.audit(actor.uid, 'proposal_participant_vote_started');
    return { ok: true, view: await this.save() };
  }

  // ---------- 取り下げ（F-59） ----------

  async withdraw(actor: FlowActor): Promise<FlowResult> {
    const status = this.status();
    if (
      !['unei_discussion', 'mod_vote', 'participant_discussion', 'participant_vote'].includes(
        status,
      )
    ) {
      return fail('conflict', '可決より前の改正案だけ取り下げられます');
    }
    const err = await this.call(() =>
      this.h.rpc.withdrawProposal({ proposalId: this.h.id, withdrawnBy: actor.uid }),
    );
    if (err) return err;
    if (this.status() !== 'draft') {
      // OpsBot が取り下げを受け付けたのに状態が合わない場合も、下書きに戻す
      await this.setStatus('draft');
    }
    this.flow.publicId = null;
    this.flow.reflect = null;
    if (status !== 'unei_discussion' || this.flow.pr) {
      this.flow.prTodo = 'close';
      this.flow.prAt = null;
    }
    await this.audit(actor.uid, 'proposal_withdrawn', { from: status });
    return { ok: true, view: await this.save() };
  }

  /** 模擬の OpsBot の投票の結果を決める（ステージング・手元の開発だけ） */
  async simDecide(actor: FlowActor, passed: boolean): Promise<FlowResult> {
    const sim = this.h.rpc as ProposalRpc & {
      decideVote?: (id: string, passed: boolean) => Promise<RuleProposalResult>;
    };
    if (!sim.simulated || !sim.decideVote) return fail('not_found', '見つかりません');
    const r = await sim.decideVote(this.h.id, passed);
    const err = await this.fromRpc(r);
    if (err) return err;
    await this.audit(actor.uid, 'proposal_sim_vote_decided', { passed });
    await this.runReflect();
    return { ok: true, view: await this.save() };
  }

  /** 止めた反映をやり直す（F-57 で止めたあと、原因を直したとき） */
  async retryReflect(actor: FlowActor): Promise<FlowResult> {
    const r = this.flow.reflect;
    if (this.status() !== 'passed' || !r)
      return fail('conflict', '反映を待っている改正案ではありません');
    if (r.stage === 'blocked') {
      r.stage = 'enact';
      r.blocked = null;
    }
    r.attempts = 0;
    r.retryAt = null;
    r.notifiedFailure = false;
    await this.audit(actor.uid, 'proposal_reflect_retried');
    await this.runReflect();
    return { ok: true, view: await this.save() };
  }

  // ---------- 時刻で進める（ProposalRoom のアラーム） ----------

  async tick(): Promise<void> {
    const now = this.h.now();
    if (this.flow.nextAt !== null && this.flow.nextAt > now) return;
    const status = this.status();
    if (status !== 'draft') await this.refreshFromOpsbot(true);
    await this.runPullTodo();
    await this.runReflect();
    await this.save();
  }

  private async runPullTodo() {
    const todo = this.flow.prTodo;
    if (!todo || (this.flow.prAt !== null && this.flow.prAt > this.h.now())) return;
    try {
      if (todo === 'open') {
        const f = await this.frozen();
        if (!f) {
          this.flow.prTodo = null;
          return;
        }
        this.flow.pr = await openDraftPull(
          this.h.repo,
          this.h.id,
          build(f.proposal),
          this.flow.title,
          this.publicUrl(),
          f.contentHash,
        );
      } else {
        const note =
          this.status() === 'enacted'
            ? `${this.flow.reflect?.finalNumber ?? ''}として main に反映しました（${this.flow.reflect?.enactSha?.slice(0, 7) ?? ''}）。`
            : '改正案を取り下げたため閉じます。';
        await closeDraftPull(this.h.repo, this.h.id, this.flow.pr, note);
        this.flow.pr = null;
      }
      this.flow.prTodo = null;
      this.flow.prAt = null;
    } catch (e) {
      // PR は参照用なので、失敗しても手続は止めない（1分後にやり直す）
      console.error('Draft PR の操作に失敗しました', e);
      this.flow.prAt = this.h.now() + 60_000;
    }
  }

  /** 可決後の反映を、待つところ（施行日・失敗の再試行・止めた）まで進める */
  private async runReflect() {
    const r = this.flow.reflect;
    if (this.status() !== 'passed' || !r) return;
    if (r.retryAt !== null && r.retryAt > this.h.now()) return;
    try {
      for (let guard = 0; guard < 10; guard++) {
        const before = r.stage;
        await this.reflectStep(r);
        if (
          r.stage === before ||
          r.stage === 'done' ||
          r.stage === 'blocked' ||
          r.stage === 'waiting'
        )
          break;
      }
      r.attempts = 0;
      r.lastError = null;
      r.retryAt = null;
    } catch (e) {
      r.attempts++;
      r.lastError = errorText(e);
      r.retryAt = this.h.now() + this.retryDelay(r.attempts);
      console.error(`改正案 ${this.h.id} の反映に失敗しました（${r.attempts}回目）`, e);
      if (r.attempts >= NOTIFY_AFTER_FAILURES && !r.notifiedFailure) {
        await this.notifyFailure(
          `ds-craft/rules への反映が${r.attempts}回続けて失敗しました：${r.lastError}`,
        );
        r.notifiedFailure = true;
      }
    }
  }

  private async notifyFailure(message: string) {
    try {
      await this.h.rpc.notifyResult({
        proposalId: this.h.id,
        kind: 'failed',
        message,
        detailUrl: this.publicUrl(),
      });
    } catch (e) {
      console.error('反映の失敗を OpsBot で知らせられませんでした', e);
    }
  }

  /** 固定した内容に、確定した番号を当てたもの */
  private async finalProposal(r: ReflectState): Promise<Proposal> {
    const f = await this.frozen();
    if (!f) throw new Error('固定した内容が見つかりません');
    if (!r.finalNumber) return f.proposal;
    const row = await this.h.db
      .prepare('SELECT kind, year, number FROM amending_numbers WHERE proposal_id = ?')
      .bind(this.h.id)
      .first<AmendingNumber>();
    return row
      ? renumberProposal(f.proposal, {
          kind: row.kind,
          year: Number(row.year),
          number: Number(row.number),
        })
      : f.proposal;
  }

  private async reflectStep(r: ReflectState) {
    const repo = this.h.repo;
    switch (r.stage) {
      case 'number': {
        const f = await this.frozen();
        if (!f) throw new Error('固定した内容が見つかりません');
        const fixed = await this.fixNumber(f.proposal.amendingNumber);
        r.finalNumber = formatRuleNumber(fixed);
        r.amendingId = formatRuleId(fixed);
        r.enforcementDate = f.proposal.enforcementDate;
        const prev = f.proposal.amendingNumber;
        if (fixed.number !== prev.number) {
          this.h.renumberDocument(fixed);
          await this.audit('system', 'proposal_number_changed', {
            from: formatRuleNumber(prev),
            to: r.finalNumber,
          });
        }
        await this.h.db
          .prepare('UPDATE proposals SET final_number = ?, amending_number = ? WHERE id = ?')
          .bind(r.finalNumber, fixed.number, this.h.id)
          .run();
        const rec = await this.h.rpc.recordFinalNumber({
          proposalId: this.h.id,
          finalNumber: r.finalNumber,
        });
        if (!rec.ok && rec.code !== 'bad_state') throw new Error(rec.message);
        r.stage = isFutureEnforcement(r.enforcementDate, this.h.now()) ? 'pending' : 'enact';
        return;
      }
      case 'pending': {
        const b = build(await this.finalProposal(r));
        const head = await repo.headSha();
        const info = head
          ? await repo.readFile(`pending/${r.amendingId}/pending.json`, head)
          : null;
        // 置いたあとに保存できなかった場合のやり直しでは、置き直さない
        if (info === null) r.pendingSha = await commitPending(repo, b, this.publicUrl());
        r.stage = 'waiting';
        return;
      }
      case 'waiting': {
        if (this.h.now() >= enforcementInstant(r.enforcementDate)) r.stage = 'enact';
        return;
      }
      case 'enact': {
        const b = build(await this.finalProposal(r));
        const head = await repo.headSha();
        if (!head) throw new Error(`${repo.repo} の main が見つかりません`);
        if (await this.alreadyEnacted(b, head)) {
          r.enactSha = r.enactSha ?? head;
          r.stage = 'cleanup';
          return;
        }
        const changed = await changedBases(repo, head, b.p);
        if (changed.length) {
          r.stage = 'blocked';
          r.blocked = {
            message:
              '改正対象のファイルが、運営投票の開始時に固定した元の版から変わっているため、反映を止めました',
            paths: changed,
          };
          await this.audit('system', 'proposal_reflect_blocked', { paths: changed });
          await this.notifyFailure(
            `${r.blocked.message}（${changed.join('、')}）。rule-builder の発議ページで対応方法を確認してください。`,
          );
          return;
        }
        r.enactSha = await commitEnactment(repo, b);
        await this.audit('system', 'proposal_enacted_commit', { sha: r.enactSha });
        r.stage = 'cleanup';
        return;
      }
      case 'cleanup': {
        const b = build(await this.finalProposal(r));
        r.cleanupSha = r.amendingId ? await commitCleanup(repo, b, r.amendingId) : null;
        r.stage = 'notify';
        return;
      }
      case 'notify': {
        const b = build(await this.finalProposal(r));
        const target = b.ex.files.find((f) => f.op !== 'repeal') ?? b.ex.files[0];
        r.portalUrl = `${this.h.portalOrigin}/rule/${target?.ruleId ?? ''}.html`;
        const res = await this.h.rpc.notifyResult({
          proposalId: this.h.id,
          kind: 'enacted',
          portalUrl: r.portalUrl,
          finalNumber: r.finalNumber ?? '',
          enforcementDate: isoToWareki(r.enforcementDate),
        });
        if (!res.ok && res.code !== 'bad_state') throw new Error(res.message);
        if (res.status) this.flow.opsbot = res.status;
        r.stage = 'done';
        this.flow.prTodo = 'close';
        this.flow.prAt = null;
        await this.setStatus('enacted');
        await this.audit('system', 'proposal_enacted', { portalUrl: r.portalUrl });
        return;
      }
      case 'done':
      case 'blocked':
        return;
    }
  }

  /** main にもう反映が入っている（反映のあとで保存できなかった場合のやり直し） */
  private async alreadyEnacted(b: ReturnType<typeof build>, head: string): Promise<boolean> {
    if (!b.ex.files.length) return false;
    for (const f of b.ex.files) {
      if ((await this.h.repo.readFile(f.path, head)) !== f.content) return false;
    }
    for (const path of b.ex.deletes) {
      if ((await this.h.repo.readFile(path, head)) !== null) return false;
    }
    return true;
  }

  /** 改正ルール番号を確定する（10-6.1）。仮番号が空いていればそれを、埋まっていれば次の空き番号を取る */
  private async fixNumber(provisional: AmendingNumber): Promise<AmendingNumber> {
    const mine = await this.h.db
      .prepare('SELECT kind, year, number FROM amending_numbers WHERE proposal_id = ?')
      .bind(this.h.id)
      .first<AmendingNumber>();
    if (mine) return { kind: mine.kind, year: Number(mine.year), number: Number(mine.number) };

    const remote = await readRemoteRules(this.h.repo);
    const authors = await this.h.repo.commitAuthors();
    const taken = await this.h.db
      .prepare('SELECT kind, year, number FROM amending_numbers WHERE kind = ? AND year = ?')
      .bind(provisional.kind, provisional.year)
      .all<AmendingNumber>();
    const used = [
      ...usedNumbers(remote.files.keys(), authors),
      ...(taken.results ?? []).map((x) => ({
        ...x,
        year: Number(x.year),
        number: Number(x.number),
      })),
    ];
    for (let i = 0; i < 20; i++) {
      const next = nextFreeNumber(provisional, used);
      const res = await this.h.db
        .prepare(
          `INSERT INTO amending_numbers (kind, year, number, proposal_id, fixed_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(next.kind, next.year, next.number, this.h.id, new Date(this.h.now()).toISOString())
        .run();
      if (res.meta.changes > 0) return next;
      used.push(next);
    }
    throw new Error('改正ルール番号を確定できませんでした');
  }
}
