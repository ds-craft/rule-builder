// 手元の開発・E2E 専用の OpsBot の代わり。デプロイしない（wrangler.jsonc の名前は本物と同じ opsbot）。
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { MemberStatus } from '../../src/opsbot/types.ts';

type StubEnv = { DEV_UNEI_IDS: string; DEV_NOT_UNEI_IDS?: string };

export class RuleBuilderRpc extends WorkerEntrypoint<StubEnv> {
  async getMemberStatus(discordUserId: string): Promise<MemberStatus> {
    const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim());
    const ids = list(this.env.DEV_UNEI_IDS);
    const isUnei =
      (ids.includes('*') || ids.includes(discordUserId)) &&
      !list(this.env.DEV_NOT_UNEI_IDS).includes(discordUserId);
    return {
      isUnei,
      onLeave: false,
      userId: discordUserId,
      viaSubaccount: false,
      displayName: `開発用 ${discordUserId.slice(-4)}`,
      avatarUrl: null,
    };
  }
}

export default {
  fetch: () => new Response('opsbot stub', { status: 404 }),
};
