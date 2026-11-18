// 模擬の OpsBot（ステージングと手元の開発）。wrangler.jsonc の OPSBOT_PROPOSALS が "sim" のときに使う。
// ステージングの rule-builder は本番の OpsBot につながっているため、発議・投票の RPC だけをここで受け、
// 本番の Discord に投票を出さないようにする（運営者の判定 getMemberStatus は本物のまま）。
// 流れと断る条件は本物（gorodrich/ops-bot の workers/src/ruleBuilder/proposals.ts）に合わせ、
// 投票の可決・否決は発議ページの「模擬の投票」のボタン（decideVote）で決める。

import type {
  NotifyResultInput,
  RecordFinalNumberInput,
  RecordParticipantDiscussionInput,
  RuleProposalErrorCode,
  RuleProposalResult,
  RuleProposalStatus,
  RuleVoteSummary,
  StartModVoteInput,
  StartParticipantVoteInput,
  SubmitProposalInput,
  WithdrawProposalInput,
} from './types.ts';
import type { ProposalRpc } from './client.ts';

const WITHDRAWABLE = new Set([
  'unei_discussion',
  'mod_vote',
  'participant_discussion',
  'participant_vote',
]);

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class SimOpsBot implements ProposalRpc {
  readonly simulated = true;
  private readonly db: D1Database;
  private readonly discussionHours: number;
  private readonly now: () => number;

  constructor(db: D1Database, discussionHours = 24, now: () => number = Date.now) {
    this.db = db;
    this.discussionHours = discussionHours;
    this.now = now;
  }

  private async load(id: string): Promise<RuleProposalStatus | null> {
    const row = await this.db
      .prepare('SELECT status FROM sim_rule_proposals WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    return row ? (JSON.parse(row.status) as RuleProposalStatus) : null;
  }

  private async save(s: RuleProposalStatus): Promise<RuleProposalResult> {
    s.updatedAt = iso(this.now());
    s.participantVoteAvailableAt = s.participantDiscussion
      ? iso(Date.parse(s.participantDiscussion.startedAt) + this.discussionHours * 3_600_000)
      : null;
    await this.db
      .prepare(
        `INSERT INTO sim_rule_proposals (id, status) VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status`,
      )
      .bind(s.proposalId, JSON.stringify(s))
      .run();
    return { ok: true, status: s };
  }

  private fail(
    code: RuleProposalErrorCode,
    message: string,
    s: RuleProposalStatus | null,
  ): RuleProposalResult {
    return { ok: false, code, message, status: s };
  }

  private vote(method: 'secret' | 'quick'): RuleVoteSummary {
    const now = this.now();
    return {
      voteId: Math.floor(now / 1000) % 1_000_000,
      method,
      startedAt: iso(now),
      closesAt: iso(now + (method === 'quick' ? 15 * 60_000 : 24 * 3_600_000)),
      status: 'open',
      result: null,
    };
  }

  async getProposalStatus(id: string) {
    return this.load(id);
  }

  async submitProposal(input: SubmitProposalInput) {
    const s = await this.load(input.proposalId);
    if (s && s.state !== 'withdrawn' && s.state !== 'unei_discussion') {
      return this.fail('bad_state', 'この改正案は発議できない状態です', s);
    }
    const at = iso(this.now());
    return this.save({
      proposalId: input.proposalId,
      state: 'unei_discussion',
      title: input.title,
      provisionalNumber: input.provisionalNumber,
      finalNumber: null,
      publicUrl: input.publicUrl,
      contentHash: null,
      proposedBy: input.proposedBy,
      proposedAt: s?.state === 'unei_discussion' ? s.proposedAt : at,
      modVote: null,
      participantDiscussion: null,
      participantVoteAvailableAt: null,
      participantVote: null,
      decidedAt: null,
      enactedAt: null,
      updatedAt: at,
    });
  }

  async startModVote(input: StartModVoteInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (s.state !== 'unei_discussion')
      return this.fail('bad_state', '運営投票を開始できない状態です', s);
    s.state = 'mod_vote';
    s.contentHash = input.contentHash;
    s.publicUrl = input.publicUrl;
    s.modVote = this.vote(input.method);
    return this.save(s);
  }

  async recordParticipantDiscussion(input: RecordParticipantDiscussionInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (s.state !== 'participant_discussion') {
      return this.fail('bad_state', '参加者協議の開始を記録できない状態です', s);
    }
    const t = Date.parse(input.startedAt);
    if (Number.isNaN(t)) return this.fail('bad_request', '開始時刻が正しくありません', s);
    if (t > this.now() + 60_000) return this.fail('bad_request', '開始時刻を未来にはできません', s);
    s.participantDiscussion = { startedAt: iso(t), startedBy: input.startedBy };
    return this.save(s);
  }

  async startParticipantVote(input: StartParticipantVoteInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (s.state !== 'participant_discussion' || !s.participantDiscussion) {
      return this.fail(
        'bad_state',
        '参加者協議の開始が記録されていないため、参加者投票を開始できません',
        s,
      );
    }
    const at = Date.parse(s.participantDiscussion.startedAt) + this.discussionHours * 3_600_000;
    if (this.now() < at) {
      return this.fail(
        'too_early',
        `参加者協議の開始から${this.discussionHours}時間がたっていないため、参加者投票を開始できません`,
        s,
      );
    }
    s.state = 'participant_vote';
    s.participantVote = this.vote('secret');
    return this.save(s);
  }

  async withdrawProposal(input: WithdrawProposalInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (s.state === 'withdrawn') return { ok: true as const, status: s };
    if (!WITHDRAWABLE.has(s.state)) return this.fail('bad_state', '取り下げられない状態です', s);
    for (const v of [s.modVote, s.participantVote]) {
      if (v?.status === 'open') {
        v.status = 'closed';
        v.result = { passed: false, yes: 0, no: 0, abstain: 0, cancelled: true };
      }
    }
    s.state = 'withdrawn';
    return this.save(s);
  }

  async recordFinalNumber(input: RecordFinalNumberInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (s.state !== 'passed')
      return this.fail('bad_state', '改正ルール番号を確定できない状態です', s);
    s.finalNumber = input.finalNumber;
    return this.save(s);
  }

  async notifyResult(input: NotifyResultInput) {
    const s = await this.load(input.proposalId);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    if (input.kind === 'enacted') {
      if (s.state === 'enacted') return { ok: true as const, status: s };
      if (s.state !== 'passed') return this.fail('bad_state', '反映済みにできない状態です', s);
      s.state = 'enacted';
      s.enactedAt = iso(this.now());
      s.finalNumber = input.finalNumber || s.finalNumber;
      console.log(`[模擬の OpsBot] 施行の告知：${s.finalNumber}「${s.title}」 ${input.portalUrl}`);
      return this.save(s);
    }
    console.log(`[模擬の OpsBot] 反映を止めた知らせ：「${s.title}」 ${input.message}`);
    return { ok: true as const, status: s };
  }

  /** 模擬の投票の結果を決める（本物の OpsBot の集計の代わり） */
  async decideVote(id: string, passed: boolean): Promise<RuleProposalResult> {
    const s = await this.load(id);
    if (!s) return this.fail('not_found', '発議の記録が見つかりません', null);
    const v =
      s.state === 'mod_vote'
        ? s.modVote
        : s.state === 'participant_vote'
          ? s.participantVote
          : null;
    if (!v || v.status !== 'open') return this.fail('bad_state', '進行中の投票がありません', s);
    v.status = 'closed';
    v.closesAt = iso(this.now());
    v.result = passed
      ? { passed: true, yes: 3, no: 0, abstain: 0 }
      : { passed: false, yes: 1, no: 2, abstain: 0 };
    if (s.state === 'mod_vote') s.state = passed ? 'participant_discussion' : 'rejected';
    else s.state = passed ? 'passed' : 'rejected';
    if (s.state !== 'participant_discussion') s.decidedAt = iso(this.now());
    return this.save(s);
  }
}
