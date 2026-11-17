/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import type { Plugin } from 'postcss';
import prefixer from 'postcss-prefix-selector';
import { defineConfig } from 'vite';

/** portal 由来の CSS を効かせる範囲（紙面の要素）。 */
export const PORTAL_SCOPE = '.rb-portal';

/** portal 由来の CSS ファイル（src/styles/portal/） */
const PORTAL_FILE = /[\\/]styles[\\/]portal[\\/]/;

// portal の CSS は html・body・* などページ全体に効くセレクタを含むため、
// ファイルは手を加えずにビルド時に紙面の要素の内側だけへ範囲を絞る。
// （main.tsx でファイルごとに読み込むこと。@import でまとめると絞り込みが効かない）
const portalScope = prefixer({
  prefix: PORTAL_SCOPE,
  includeFiles: [PORTAL_FILE],
  transform(prefix, selector, prefixed) {
    if (/^(html|body|:root)\b/.test(selector)) {
      // html:has(:modal) などページ全体の状態に依存するものは捨てる
      if (/^(html|body):has/.test(selector)) return `${prefix}-unused`;
      return selector.replace(/^(html|body|:root)(\s+(html|body))?/, prefix);
    }
    return prefixed;
  },
});

// portal の印刷用 CSS（@media print）は portal の画面のためのもの（本文以外をすべて隠すなど）で、
// このアプリの印刷（新旧対照表）を消してしまうので読み込まない。印刷の見た目は styles/app/ で決める。
const dropPortalPrint: Plugin = {
  postcssPlugin: 'drop-portal-print',
  Once(root) {
    if (!PORTAL_FILE.test(root.source?.input.file ?? '')) return;
    root.walkAtRules('media', (rule) => {
      if (/\bprint\b/.test(rule.params)) rule.remove();
    });
  },
};

// 公開先は https://builder.ds2.uk/（GitHub Pages のカスタムドメイン）
export default defineConfig({
  base: '/',
  plugins: [react()],
  css: { postcss: { plugins: [dropPortalPrint, portalScope] } },
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
  },
});
