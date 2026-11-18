// E2E で使うポート（手元の開発用の 5173・8787、結合テストの 8790 と重ならないようにする）
export const APP_PORT = 5181;
export const API_PORT = 8791;
export const API = `http://localhost:${API_PORT}`;
