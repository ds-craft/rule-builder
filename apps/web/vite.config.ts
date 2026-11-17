/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 公開先は https://builder.ds2.uk/（GitHub Pages のカスタムドメイン）
export default defineConfig({
  base: '/',
  plugins: [react()],
  test: {
    name: 'web',
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
  },
});
