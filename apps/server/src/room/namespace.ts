// ProposalRoom の Durable Object を名前（改正案 ID）で得る。
// wrangler types は Durable Object のクラスの型を付けないため、ここで付ける。
import { getServerByName } from 'partyserver';
import type { ProposalRoom } from './ProposalRoom.ts';

export function proposalRoom(env: Env, id: string) {
  return getServerByName(env.ProposalRoom as unknown as DurableObjectNamespace<ProposalRoom>, id);
}
