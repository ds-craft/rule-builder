// GitHub App の認証（手順書 10-6.4）：Workers の WebCrypto で JWT（RS256）を署名し、インストールトークンを得る。
// 秘密鍵は Workers のシークレット GITHUB_APP_PRIVATE_KEY（GitHub からダウンロードした .pem をそのまま入れる）。
// GitHub が配る鍵は PKCS#1（BEGIN RSA PRIVATE KEY）なので、WebCrypto が読める PKCS#8 に包み直す。

const enc = new TextEncoder();

function base64url(bytes: Uint8Array | string): string {
  const b = typeof bytes === 'string' ? enc.encode(bytes) : bytes;
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemBody(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----(BEGIN|END) [A-Z ]+-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function der(tag: number, body: Uint8Array | number[]): Uint8Array {
  const b = body instanceof Uint8Array ? body : new Uint8Array(body);
  const head = [tag, ...derLength(b.length)];
  const out = new Uint8Array(head.length + b.length);
  out.set(head);
  out.set(b, head.length);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** PKCS#1 の RSA 秘密鍵を PKCS#8 に包む */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = der(0x02, [0x00]);
  // rsaEncryption（1.2.840.113549.1.1.1）と NULL
  const algorithm = der(
    0x30,
    concat(der(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]), der(0x05, [])),
  );
  return der(0x30, concat(version, algorithm, der(0x04, pkcs1)));
}

export async function importAppKey(pem: string): Promise<CryptoKey> {
  const body = pemBody(pem);
  const pkcs8 = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(body) : body;
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** GitHub App の JWT（有効期間は GitHub の上限の10分より短い9分。時計のずれに備えて発行時刻を1分戻す） */
export async function appJwt(appId: string, key: CryptoKey, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000) - 60;
  const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: appId }));
  const data = `${head}.${payload}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(data)));
  return `${data}.${base64url(sig)}`;
}

export type AppCredentials = { appId: string; privateKey: string };

type Cached = { token: string; expiresAt: number };

/**
 * リポジトリのインストールトークンを得る（期限の5分前まで使い回す）。
 * インストール ID は GET /repos/{owner}/{repo}/installation で調べる（設定に持たない）。
 */
export class InstallationTokens {
  private cached: Cached | null = null;
  private readonly creds: AppCredentials;
  private readonly repo: string;
  private readonly fetchFn: typeof fetch;
  private readonly api: string;

  constructor(creds: AppCredentials, repo: string, fetchFn: typeof fetch, api: string) {
    this.creds = creds;
    this.repo = repo;
    this.fetchFn = fetchFn;
    this.api = api;
  }

  async get(now = Date.now()): Promise<string> {
    if (this.cached && this.cached.expiresAt - 5 * 60_000 > now) return this.cached.token;
    const jwt = await appJwt(this.creds.appId, await importAppKey(this.creds.privateKey), now);
    const headers = {
      authorization: `Bearer ${jwt}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'rule-builder',
      'x-github-api-version': '2022-11-28',
    };
    const inst = await this.fetchFn(`${this.api}/repos/${this.repo}/installation`, { headers });
    if (!inst.ok) {
      throw new Error(`GitHub App が ${this.repo} にインストールされていません（${inst.status}）`);
    }
    const { id } = (await inst.json()) as { id: number };
    const res = await this.fetchFn(`${this.api}/app/installations/${id}/access_tokens`, {
      method: 'POST',
      headers,
    });
    if (!res.ok) throw new Error(`GitHub App のトークンを得られませんでした（${res.status}）`);
    const body = (await res.json()) as { token: string; expires_at: string };
    this.cached = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    return body.token;
  }
}
