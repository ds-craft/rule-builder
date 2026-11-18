// E2E で使うポート（手元の開発用の 5173・8787、結合テストの 8790 と重ならないようにする）
export const APP_PORT = 5181;
export const API_PORT = 8791;
export const API = `http://localhost:${API_PORT}`;
/** メモリ上の GitHub（自動反映の先と、画面が読む公開中のルール） */
export const GITHUB_PORT = 8792;
export const GITHUB = `http://127.0.0.1:${GITHUB_PORT}`;
export const RULES_REPO = 'ds-craft/rules-staging';
