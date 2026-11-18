import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'coverage/**',
      'prototype/**',
      '**/.wrangler/**',
      'apps/server/src/worker-configuration.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // 条文は全角空白を区切りに使うため、文字列・正規表現・コメントでは許可する
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipComments: true, skipRegExps: true, skipTemplates: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    languageOptions: { globals: { ...globals.es2023 } },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // HMR のための警告。共有の関数をコンポーネントと同じファイルに置くことがあるため切る
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['apps/server/**/*.ts'],
    languageOptions: { globals: { ...globals.es2023, ...globals.serviceworker } },
  },
  {
    files: ['apps/server/test/**/*.ts', 'apps/server/vitest.*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['*.{js,ts}', '**/vite.config.ts', '**/vitest.config.ts', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
);
