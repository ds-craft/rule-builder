# フィクスチャの取得元

回帰テスト（Markdown → モデル → Markdown の往復）に使う現行ルールの Markdown。手で編集しない。

| ディレクトリ | 取得元 | コミット |
| --- | --- | --- |
| `rules/` | [ds-craft/rules](https://github.com/ds-craft/rules) の `rules/`（施行中7件・`repealed/` 廃止4件） | `8c0b1acfb2ea06a2c7118d77a1c2cd9b274103d4` |
| `versions/` | [ds-craft/portal](https://github.com/ds-craft/portal) の `_rule_versions/`（過去の版。`script/rule_history.py` が生成） | `fb5a7ef2c5fdde8c531d8d36e6670236a22cf564` |

- 改行コードは LF（リポジトリ上の内容のまま）。
- 更新するときはコピーし直し、この表のコミットSHAを書き換える。

## 新旧対照表の検証データ

| ファイル | 取得元 | コミット |
| --- | --- | --- |
| `../portal/rule_history.json` | ds-craft/portal の `_data/rule_history.json`（`script/rule_history.py` が生成した改正履歴と条文比較の HTML） | `fb5a7ef2c5fdde8c531d8d36e6670236a22cf564` |

## コミットの再現の検証データ（`../commits/`）

ds-craft/rules の次のコミットの前後のファイルとコミットメッセージ（`git show`・`git log --format=%B`）。

| 改正ルール | コミット |
| --- | --- |
| 令和8年ルール第2号（基本ルールの改正） | `246f5272e8fd01506c8923244f1d5690a8654dc6` |
| 令和8年ルール第3号（制定と R0401003 の廃止） | `a7d3d20816f701d70ed98b4100df343e32c0ee8c` |
