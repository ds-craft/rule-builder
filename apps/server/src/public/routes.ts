// 公開リンク（ログイン不要の読み取り）：GET /public/:publicId
// 発議済みの改正案だけを返す。中身はルールごとの Markdown（新旧対照表は画面が改正前後から作る）・状態・投票の締切に限り、
// 編集者名やカーソルは返さない。publicId は改正案 ID とは別の128ビット以上の乱数（Phase 10 の発議で発行する）。

import { Hono } from 'hono';
import { apiError } from '../http/errors.ts';
import { proposalRoom } from '../room/namespace.ts';
import type { AppEnv } from '../types.ts';

/** 128ビット以上の乱数を base64url にしたもの（22文字以上） */
const PUBLIC_ID = /^[A-Za-z0-9_-]{22,64}$/;

export const publicRoutes = new Hono<AppEnv>();

publicRoutes.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Robots-Tag', 'noindex');
});

publicRoutes.get('/:publicId', async (c) => {
  const publicId = c.req.param('publicId');
  if (!PUBLIC_ID.test(publicId)) return apiError('not_found', '見つかりません');
  const row = await c.env.DB.prepare(
    "SELECT id FROM proposals WHERE public_id = ? AND status <> 'draft'",
  )
    .bind(publicId)
    .first<{ id: string }>();
  if (!row) return apiError('not_found', '見つかりません');
  const stub = await proposalRoom(c.env, row.id);
  const view = await stub.publicView();
  // 運営内協議中は内容が変わるため、短いキャッシュにとどめる
  return c.json(view, 200, { 'Cache-Control': 'public, max-age=60' });
});
