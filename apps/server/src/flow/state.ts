// 発議・採決・自動反映の状態（ProposalRoom の room_meta に JSON で置く）と、画面に返す形。

import type { ProposalStatus } from '@rule-builder/core';
import type { RuleProposalStatus } from '../opsbot/types.ts';

/** 反映の段階（手順書 10-6） */
export type ReflectStage =
  /** 改正ルール番号を確定する */
  | 'number'
  /** 施行前として pending/<改正ルールID>/ を main に置く */
  | 'pending'
  /** 施行日の 0時を待つ */
  | 'waiting'
  /** 規約どおりのコミットで rules/ に反映する */
  | 'enact'
  /** pending/<改正ルールID>/ を消す */
  | 'cleanup'
  /** 反映済みにして告知する（OpsBot の notifyResult・Draft PR を閉じる） */
  | 'notify'
  | 'done'
  /** 改正対象のファイルが元の版から変わっていたので止めた（F-57） */
  | 'blocked';

export type ReflectState = {
  stage: ReflectStage;
  /** 確定した改正ルール番号（令和8年ルール第4号）と改正ルールID（R0801004） */
  finalNumber: string | null;
  amendingId: string | null;
  enforcementDate: string;
  /** 作ったコミット（やり直しのとき、もう main に入っていれば作り直さない） */
  pendingSha: string | null;
  enactSha: string | null;
  cleanupSha: string | null;
  /** 続けて失敗した回数と最後の失敗（5回続いたら運営者に知らせる） */
  attempts: number;
  lastError: string | null;
  /** 次に再試行する時刻（ms。失敗したときだけ） */
  retryAt: number | null;
  notifiedFailure: boolean;
  /** 止めた理由（F-57）。変わっていたファイル */
  blocked: { message: string; paths: string[] } | null;
  portalUrl: string | null;
};

export type FlowState = {
  /** 公開リンクの ID（発議で発行し、取り下げで止める） */
  publicId: string | null;
  /** 題名（件名から「施行」を除いたもの） */
  title: string;
  /** OpsBot の記録の写し（最後に問い合わせたもの） */
  opsbot: RuleProposalStatus | null;
  /** 最後に OpsBot に問い合わせた時刻（ms） */
  polledAt: number;
  /** 次に手続を進める時刻（ms。投票の結果の問い合わせ・反映の再試行・施行日） */
  nextAt: number | null;
  /** GitHub の Draft PR（運営投票の開始で作り、取り下げ・反映で閉じる） */
  pr: { number: number; url: string } | null;
  /** まだ済んでいない PR の操作（失敗したら次の機会にやり直す） */
  prTodo: 'open' | 'close' | null;
  /** PR の操作を行う時刻（ms。すぐ行い、失敗したら1分後） */
  prAt: number | null;
  reflect: ReflectState | null;
};

export const emptyFlow = (): FlowState => ({
  publicId: null,
  title: '',
  opsbot: null,
  polledAt: 0,
  nextAt: null,
  pr: null,
  prTodo: null,
  prAt: null,
  reflect: null,
});

/** 発議前の確認（F-50）の1項目 */
export type PreflightCheck = {
  key: 'entries' | 'enforcement' | 'lint' | 'refs' | 'base';
  label: string;
  ok: boolean;
  /** 満たさないときの説明（ルール名など） */
  details: string[];
};

/** 画面に返す手続の状態（GET /proposals/:id/flow） */
export type FlowView = {
  status: ProposalStatus;
  /** 運営投票の開始後（編集できない） */
  locked: boolean;
  title: string;
  publicUrl: string | null;
  /** 模擬の OpsBot（発議ページに「模擬の投票」を出す） */
  simulated: boolean;
  opsbot: RuleProposalStatus | null;
  frozen: { at: string; by: string; contentHash: string } | null;
  pr: { number: number; url: string } | null;
  reflect:
    (Omit<ReflectState, 'notifiedFailure' | 'retryAt'> & { nextAttemptAt: string | null }) | null;
  /** 反映する先（ds-craft/rules・ステージングは ds-craft/rules-staging） */
  rulesRepo: string;
  polledAt: string | null;
};

export type FlowError = {
  error: 'bad_request' | 'conflict' | 'unavailable' | 'forbidden' | 'not_found';
  message: string;
  checks?: PreflightCheck[];
};

export type FlowResult = { ok: true; view: FlowView } | ({ ok: false } & FlowError);

/** 操作した運営者（Worker がセッションから渡す） */
export type FlowActor = { uid: string; name: string };
