// ルーティング（Hono）。画面（APP_ORIGIN）からの呼び出しだけを受け付ける。
//   /auth/*       ログイン（routes.ts）
//   /proposals/*  運営の改正案の一覧と同期（運営者のみ）
//   /public/*     公開リンク（ログイン不要）

import { Hono, type MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './auth/routes.ts';
import { apiError } from './http/errors.ts';
import { proposalRoutes } from './proposals/routes.ts';
import { publicRoutes } from './public/routes.ts';
import type { AppEnv } from './types.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isUpgrade = (req: Request) => req.headers.get('upgrade')?.toLowerCase() === 'websocket';

/**
 * CSRF 対策：状態を変える API と WebSocket の接続は、Origin が画面のものでなければ断る。
 * （WebSocket には CORS が効かないため、他のサイトからの接続をここで止める）
 */
const checkOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const req = c.req.raw;
  if (!SAFE_METHODS.has(req.method) || isUpgrade(req)) {
    if (req.headers.get('origin') !== c.env.APP_ORIGIN) {
      return apiError('bad_origin', 'この操作は rule-builder の画面からだけ行えます');
    }
  }
  await next();
};

/** CORS（Cookie つき）。WebSocket の応答（101）はヘッダーを書き換えられないので通さない */
const corsForApp: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (isUpgrade(c.req.raw)) return next();
  return cors({
    origin: c.env.APP_ORIGIN,
    credentials: true,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowHeaders: ['content-type'],
    maxAge: 600,
  })(c, next);
};

export function createApp() {
  const app = new Hono<AppEnv>();
  app.use('*', corsForApp);
  app.use('*', checkOrigin);
  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/auth', authRoutes);
  app.route('/proposals', proposalRoutes);
  app.route('/public', publicRoutes);
  app.notFound(() => apiError('not_found', '見つかりません'));
  app.onError((err) => {
    console.error(err);
    return Response.json(
      {
        error: 'internal',
        message: 'サーバーで問題が起きました。しばらくしてからやり直してください',
      },
      { status: 500 },
    );
  });
  return app;
}
