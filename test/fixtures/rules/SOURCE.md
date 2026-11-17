# フィクスチャの取得元

回帰テスト（Markdown → モデル → Markdown の往復）に使う現行ルールの Markdown。手で編集しない。

| ディレクトリ | 取得元 | コミット |
| --- | --- | --- |
| `rules/` | [ds-craft/rules](https://github.com/ds-craft/rules) の `rules/`（施行中7件・`repealed/` 廃止4件） | `8c0b1acfb2ea06a2c7118d77a1c2cd9b274103d4` |
| `versions/` | [ds-craft/portal](https://github.com/ds-craft/portal) の `_rule_versions/`（過去の版。`script/rule_history.py` が生成） | `fb5a7ef2c5fdde8c531d8d36e6670236a22cf564` |

- 改行コードは LF（リポジトリ上の内容のまま）。
- 更新するときはコピーし直し、この表のコミットSHAを書き換える。
