// Discord の OAuth2（scope は identify だけ）。OpsBot の Discord アプリケーションを使う。

const DISCORD = 'https://discord.com';

export const redirectUri = (env: Env) => `${env.API_ORIGIN}/auth/callback`;

export function authorizeUrl(env: Env, state: string): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: env.DISCORD_CLIENT_ID,
    scope: 'identify',
    state,
    redirect_uri: redirectUri(env),
    prompt: 'none',
  });
  return `${DISCORD}/oauth2/authorize?${q}`;
}

function clientAuth(env: Env) {
  return { client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET };
}

/** 認可コードをアクセストークンに換える */
export async function exchangeCode(env: Env, code: string): Promise<string> {
  const res = await fetch(`${DISCORD}/api/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...clientAuth(env),
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(env),
    }),
  });
  if (!res.ok) throw new Error(`Discord のトークン交換に失敗しました: ${res.status}`);
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string')
    throw new Error('Discord の応答にトークンがありません');
  return body.access_token;
}

/** アクセストークンの持ち主の Discord ユーザー ID */
export async function fetchUserId(token: string): Promise<string> {
  const res = await fetch(`${DISCORD}/api/users/@me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Discord のユーザー取得に失敗しました: ${res.status}`);
  const body = (await res.json()) as { id?: unknown };
  if (typeof body.id !== 'string' || !/^\d{17,20}$/.test(body.id)) {
    throw new Error('Discord の応答にユーザー ID がありません');
  }
  return body.id;
}

/** ID を得たらトークンは要らないので取り消す（失敗しても続ける） */
export async function revokeToken(env: Env, token: string): Promise<void> {
  await fetch(`${DISCORD}/api/oauth2/token/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...clientAuth(env), token, token_type_hint: 'access_token' }),
  }).catch(() => {});
}
