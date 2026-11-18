// 開いている改正案の発議・採決の状態（F-50〜F-59）。状態を変えるのはサーバーだけで、画面はボタンで頼むだけ。
// サーバーから状態が変わった知らせ（独自メッセージ）が届いたら読み直す。投票中・参加者協議中は1分ごとにも読み直す
// （締切や「参加者投票を開始」を押せるようになる時刻を過ぎたことを、知らせがなくても出せるように）。

import { create } from 'zustand';
import {
  ApiError,
  fetchFlow,
  flowAction,
  type FlowAction,
  type FlowView,
  type PreflightCheck,
} from '../server/api.ts';
import { useApp } from './store.ts';

type FlowStore = {
  /** 改正案 ID（読み込んだもの） */
  id: string | null;
  view: FlowView | null;
  /** 読み込めなかった（オフライン・サーバーにない） */
  error: string | null;
  /** 押したボタン（終わるまでほかのボタンを押せなくする） */
  busy: FlowAction['kind'] | null;
  /** サーバーが断った発議前の確認 */
  serverChecks: PreflightCheck[] | null;
};

export const useFlow = create<FlowStore>(() => ({
  id: null,
  view: null,
  error: null,
  busy: null,
  serverChecks: null,
}));

function apply(id: string, view: FlowView) {
  if (useFlow.getState().id !== id) return;
  useFlow.setState({ view, error: null });
  useApp.getState().setFlowLocked(view.locked);
}

/** 手続の状態を読み直す */
export async function loadFlow(id: string): Promise<void> {
  if (useFlow.getState().id !== id) {
    useFlow.setState({ id, view: null, error: null, busy: null, serverChecks: null });
  }
  try {
    apply(id, await fetchFlow(id));
  } catch (e) {
    if (useFlow.getState().id !== id) return;
    useFlow.setState({
      error: e instanceof Error ? e.message : '発議の状況を読み込めませんでした',
    });
  }
}

export function resetFlow() {
  useFlow.setState({ id: null, view: null, error: null, busy: null, serverChecks: null });
  useApp.getState().setFlowLocked(false);
}

/** ボタンの操作をサーバーに頼む。成功したら true（失敗はトーストで知らせる） */
export async function runFlow(action: FlowAction): Promise<boolean> {
  const { id, busy } = useFlow.getState();
  if (!id || busy) return false;
  useFlow.setState({ busy: action.kind, serverChecks: null });
  try {
    apply(id, await flowAction(id, action));
    return true;
  } catch (e) {
    const checks =
      e instanceof ApiError ? (e.body.checks as PreflightCheck[] | undefined) : undefined;
    if (checks) useFlow.setState({ serverChecks: checks });
    useApp.getState().showToast(e instanceof Error ? e.message : '操作できませんでした');
    // 断られたときは、サーバーの状態に合わせ直す
    void loadFlow(id);
    return false;
  } finally {
    useFlow.setState({ busy: null });
  }
}

/** 定期的に読み直すべき状態か（投票中・参加者協議中・反映待ち） */
export const needsPolling = (v: FlowView | null) =>
  !!v && ['mod_vote', 'participant_discussion', 'participant_vote', 'passed'].includes(v.status);
