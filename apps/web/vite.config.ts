/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import prefixer from 'postcss-prefix-selector';
import { defineConfig } from 'vite';

/** portal 由来の CSS を効かせる範囲（紙面の要素）。 */
export const PORTAL_SCOPE = '.rb-portal';

// portal の CSS（src/styles/portal/）は html・body・* などページ全体に効くセレクタを含むため、
// ファイルは手を加えずにビルド時に紙面の要素の内側だけへ範囲を絞る。
const portalScope = prefixer({
  prefix: PORTAL_SCOPE,
  includeFiles: [/[\\/]styles[\\/]portal[\\/]/],
  transform(prefix, selector, prefixed) {
    if (/^(html|body|:root)\b/.test(selector)) {
      // html:has(:modal) などページ全体の状態に依存するものは捨てる
      if (/^(html|body):has/.test(selector)) return `${prefix}-unused`;
      return selector.replace(/^(html|body|:root)(\s+(html|body))?/, prefix);
    }
    return prefixed;
  },
});

// 公開先は https://builder.ds2.uk/（GitHub Pages のカスタムドメイン）
export default defineConfig({
  base: '/',
  plugins: [react()],
  css: { postcss: { plugins: [portalScope] } },
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
  },
});
