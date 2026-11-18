// OpsBot の RPC（Service Binding）。型は ./types.ts（OpsBot 側の定義の写し）。
import type { RuleBuilderRpcMethods } from './types.ts';

export function opsbot(env: Env): RuleBuilderRpcMethods {
  return env.OPSBOT as unknown as RuleBuilderRpcMethods;
}
