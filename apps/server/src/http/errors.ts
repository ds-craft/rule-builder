// API の失敗の返し方。画面は error で分岐し、message をそのまま出す。

export type ApiErrorCode =
  'unauthenticated' | 'forbidden' | 'unavailable' | 'bad_request' | 'not_found' | 'bad_origin';

export type ApiError = { error: ApiErrorCode; message: string };

export const STATUS: Record<ApiErrorCode, 400 | 401 | 403 | 404 | 503> = {
  unauthenticated: 401,
  forbidden: 403,
  unavailable: 503,
  bad_request: 400,
  not_found: 404,
  bad_origin: 403,
};

export function apiError(error: ApiErrorCode, message: string): Response {
  return Response.json({ error, message } satisfies ApiError, { status: STATUS[error] });
}
