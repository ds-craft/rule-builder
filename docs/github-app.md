# rule-builder の GitHub App

可決した改正を ds-craft/rules に反映するための、rule-builder 専用の GitHub App（手順書 10-7.1）。ポータル通知用の既存の App「ds-craft-rules-notifier」は使い回さない。

| 項目 | 値 |
| --- | --- |
| 置き場所 | ds-craft 組織 |
| 名前 | `ds-craft-rule-builder` |
| 権限 | Contents（Read and write）、Pull requests（Read and write）。Metadata（Read-only）は自動で付く |
| Webhook | 使わない |
| インストール先 | ds-craft/rules（本番）と ds-craft/rules-staging（ステージング）だけ |
| 秘密鍵 | Workers のシークレット `GITHUB_APP_PRIVATE_KEY`（本番・ステージングの両方） |
| App ID | `apps/server/wrangler.jsonc` の `GITHUB_APP_ID`（本番・ステージングの両方。秘密情報ではない） |

## 1. App を作る

1. <https://github.com/organizations/ds-craft/settings/apps/new> を開く。
2. 次のとおり入れる。ほかは既定のまま。
   - **GitHub App name**：`ds-craft-rule-builder`
   - **Homepage URL**：`https://builder.ds2.uk`
   - **Webhook**：「Active」のチェックを外す
   - **Repository permissions**：
     - Contents：Read and write
     - Pull requests：Read and write
   - **Where can this GitHub App be installed?**：Only on this account
3. 「Create GitHub App」を押す。
4. 作られた App のページの上にある **App ID**（数字）を控える。
5. 同じページの下の「Private keys」で「Generate a private key」を押し、.pem ファイルをダウンロードする。

## 2. インストールする

1. App のページの左の「Install App」→ ds-craft の「Install」を押す。
2. 「Only select repositories」を選び、`ds-craft/rules` と `ds-craft/rules-staging` を選んで「Install」を押す。

## 3. 秘密鍵と App ID を登録する

ダウンロードした .pem をそのまま渡す（中身を画面に出さない）。`apps/server` で実行する。

```sh
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < ~/Downloads/ds-craft-rule-builder.*.private-key.pem
npx wrangler secret put GITHUB_APP_PRIVATE_KEY --env staging < ~/Downloads/ds-craft-rule-builder.*.private-key.pem
```

`apps/server/wrangler.jsonc` の `GITHUB_APP_ID`（2か所：本番と `env.staging`）に App ID を入れてコミットする。

登録できたら、.pem は消してよい（なくしたら、App のページで作り直して登録し直す）。

## 4. ds-craft/rules の main を守る（ルールセット）

App を作ったあと、ds-craft/rules の main にルールセットを設定する（10-7.2）。設定済み（2026-11-18）。

| ルールセット | ルール | 例外 |
| --- | --- | --- |
| main の強制 push・削除の禁止 | ブランチの削除の禁止、強制 push の禁止 | なし |
| main の更新は rule-builder の自動反映と運営の手作業だけ | 更新の制限（Restrict updates） | rule-builder の App、組織の管理者（gorodrich。手作業のコミット用） |

- ルールセットの例外は、そのルールセットの全部のルールに効く。1つにまとめると例外の側が強制 push もできてしまうので、2つに分けている。
- ルールセットの例外には個人を直接は入れられないため、gorodrich は「組織の管理者」として入れている。
- PR 必須・ステータスチェック必須・署名付きコミット必須はかけない（作者・日時を指定した自動反映のコミットが作れなくなるため）。
- ds-craft/rules-staging にはかけない（試験で自由に戻せるようにする）。

## 仕組み

- サーバー（`apps/server/src/github/app.ts`）が WebCrypto で JWT（RS256）を署名し、`GET /repos/{repo}/installation` でインストール ID を調べてインストールトークンを得る。GitHub が配る PKCS#1 の鍵は、読み込むときに PKCS#8 に包み直す。
- 反映は Git Data API（tree → commit → ref の早送り）で行い、GitHub のマージボタンは使わない。作者・コミッターは改正ルール番号、日時は施行日 00:00 +09:00。メールは、まず空で作り、GitHub が受け付けなければ（422）`noreply@ds2.uk` にする（`rule_history.py` は作者名だけを見る）。Git Data API はメールの空を受け付けないため、実際には `noreply@ds2.uk` になる（2026-11-18 に rules-staging で確認。手作業で push した過去のコミットはメールが空のまま）。
- 施行前の掲載（`pending/<改正ルールID>/`）と、その削除のコミットは、作者・コミッターを指定しない（GitHub App になる）。
- 手元の開発と結合テストでは、App の代わりに `GITHUB_TOKEN`（と `GITHUB_API`）でメモリ上の GitHub につなぐ。
