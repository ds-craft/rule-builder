# rule-builder

3DS半分こするくらい仲良しクラフトのルール（[ds-craft/rules](https://github.com/ds-craft/rules)）を、ポータルと同じ見た目のまま Word のような操作で編集し、改正案として書き出すための Web アプリです。

- 公開URL：<https://builder.ds2.uk/>
- 条文の見た目・判定は [ds-craft/portal](https://github.com/ds-craft/portal) に合わせています。

## 構成

npm workspaces のモノレポです。

| ディレクトリ | 内容 |
| --- | --- |
| `packages/core` | 画面とサーバーで共有する処理（内部モデル、Markdown ⇔ モデルの変換、番号、差分、出力、書式チェック）。DOM・ブラウザ API に依存しない |
| `apps/web` | 画面（Vite + React + TypeScript。GitHub Pages で公開） |
| `test/fixtures/rules` | 回帰テスト用の現行ルールの Markdown |

## 開発

Node.js 22 以上が必要です。

```bash
npm install
npm run dev        # 開発サーバー（apps/web）
npm test           # 全パッケージのテスト（Vitest）
npm run lint       # ESLint と Prettier のチェック
npm run format     # Prettier で整形
npm run build      # 全パッケージのビルド
```

## 公開

`main` への push で GitHub Actions（`.github/workflows/deploy.yml`）が lint・テスト・ビルドを行い、`apps/web/dist` を GitHub Pages に公開します。PR では lint・テスト・ビルドだけを行います。

## ライセンス

[MIT](LICENSE)
