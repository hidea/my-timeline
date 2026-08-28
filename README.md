# my-timeline

## 画面から使う

Finderで `My Timeline.command` をダブルクリックします。ブラウザで期間と取得元を選び、**収集して開く**を押すと、時系列画面と素材フォルダが自動的に開きます。ターミナルから起動する場合は `npm start` です。

My TimelineはこのMac内の固定アドレス `http://127.0.0.1:4177/` で動作します。`127.0.0.1` はローカルホストなので外部には公開されません。素材追加リンクとGmail OAuthのリダイレクトURIも、この標準アドレスを前提としています。

旅行記を書く間だけ使う素材収集ツールです。指定期間（最大31日）のBluesky、X、Flickr、Stravaを集め、Finderで扱えるフラットな素材と、ローカルで開けるタイムラインを「ダウンロード」に生成します。永続DBは使いません。執筆後は生成フォルダをFinderから削除できます。

## 準備

- bskylog MCPを起動（既定値: `http://localhost:8080/sse`）
- Xは既存プロジェクトと同じ `mcp-remote@0.1.37` OAuthセッションを利用します。初回または期限切れ時はブラウザ認証が開きます。Bearerトークンを直接使う場合だけ `TWILOG_MCP_TOKEN` を設定します。
- Flickrの公開写真を使う場合: `FLICKR_API_KEY` と `FLICKR_USER_ID`。`FLICKR_API_SECRET` は非公開写真のOAuth対応までは使用しません。

Flickrの秘密値は `.env` に保存します。既存のFlickr Downloadrの暗号化資格情報は読みません。非公開・限定公開写真を含めるには、一度だけ次を実行してブラウザで読み取り権限を許可します。

```sh
node --env-file=.env src/cli.js flickr-auth
```

成功するとOAuthトークンが `.env` に追記されます。

## 使い方

```sh
node src/cli.js collect \
  --from 2025-08-01 \
  --to 2025-08-14 \
  --title "京都旅行"
```

利用できるソースだけ指定できます。

```sh
node src/cli.js collect \
  --from 2025-08-01 \
  --to 2025-08-14 \
  --sources bluesky \
  --output "$TMPDIR/kyoto-writing"
```

生成物:

- `materials/`: 日時順のMarkdownと画像
- `selected/`: 採用写真を置く空フォルダ
- `timeline.html`: 検索・ソース絞り込み付き一覧
- `manifest.json`: 一時ワークスペースの索引
- `itinerary.md`, `outline.md`, `draft.md`: 執筆用ファイル

MCPのツール定義は次で確認できます。

```sh
node src/cli.js inspect-mcp --url http://localhost:8080/sse
```

## スキル

Codex向けスキルは `skills/travel-writing/` にあります。完成素材の削除は、ユーザーの明示確認後にだけ行うよう定義しています。

## テスト

```sh
npm test
```
