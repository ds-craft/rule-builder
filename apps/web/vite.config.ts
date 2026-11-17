/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import type { Plugin } from 'postcss';
import prefixer from 'postcss-prefix-selector';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

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

// PWA（Phase 8）：初回読み込み後はオフラインでも編集・出力できるよう、画面のファイルを Service Worker に置く。
// 改正案は IndexedDB にあるので、ネットワークが無くても開ける。ルールの取得（GitHub）は届くときだけ。
const pwa = VitePWA({
  registerType: 'autoUpdate',
  injectRegister: 'script-defer',
  includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
  manifest: {
    name: 'ルール編集（rule-builder）',
    short_name: 'ルール編集',
    description: 'ルールの改正案を作成・編集します',
    lang: 'ja',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#0017c1',
    background_color: '#ffffff',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
    // HashRouter なので、どの URL も index.html を返せばよい
    navigateFallback: '/index.html',
    runtimeCaching: [
      {
        // 文字（Noto Sans JP）
        urlPattern: ({ url }) =>
          url.origin === 'https://fonts.googleapis.com' ||
          url.origin === 'https://fonts.gstatic.com',
        handler: 'StaleWhileRevalidate',
        options: { cacheName: 'fonts', expiration: { maxEntries: 60 } },
      },
      {
        // SHA を指定したルールの本文は変わらない
        urlPattern: ({ url }) => url.origin === 'https://raw.githubusercontent.com',
        handler: 'CacheFirst',
        options: { cacheName: 'rules-raw', expiration: { maxEntries: 300 } },
      },
      {
        // ルールの一覧・main の SHA は新しいものを優先し、届かなければ前回の結果
        urlPattern: ({ url }) => url.origin === 'https://api.github.com',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'rules-api',
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 50 },
        },
      },
    ],
  },
});

// 公開先は https://builder.ds2.uk/（GitHub Pages のカスタムドメイン）
export default defineConfig({
  base: '/',
  plugins: [react(), pwa],
  css: { postcss: { plugins: [dropPortalPrint, portalScope] } },
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
  },
});
