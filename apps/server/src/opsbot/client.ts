// OpsBot の RPC（Service Binding）。型は ./types.ts（OpsBot 側の定義の写し）。
// 運営者の判定（getMemberStatus）は常に本物の OpsBot を使う。
// 発議・採決は OPSBOT_PROPOSALS が "sim" なら模擬の OpsBot（sim.ts）を使う（ステージング・手元の開発）。
import { SimOpsBot } from './sim.ts';
import type { RuleBuilderRpcMethods } from './types.ts';

export function opsbot(env: Env): RuleBuilderRpcMethods {
  return env.OPSBOT as unknown as RuleBuilderRpcMethods;
}

/** 発議・採決の RPC（getMemberStatus を除いたもの） */
export type ProposalRpc = Omit<RuleBuilderRpcMethods, 'getMemberStatus'> & {
  /** 模擬の OpsBot なら true（発議ページに「模擬の投票」のボタンを出す） */
  readonly simulated?: boolean;
};

export function isSimulated(env: Env): boolean {
  return env.OPSBOT_PROPOSALS === 'sim';
}

export function proposalRpc(env: Env): ProposalRpc {
  if (isSimulated(env)) {
    const hours = Number(env.SIM_DISCUSSION_HOURS);
    return new SimOpsBot(env.DB, Number.isFinite(hours) && hours >= 0 ? hours : 24);
  }
  return opsbot(env);
}

export function simOpsBot(env: Env): SimOpsBot | null {
  const rpc = proposalRpc(env);
  return rpc instanceof SimOpsBot ? rpc : null;
}
