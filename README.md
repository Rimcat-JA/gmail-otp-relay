# Gmail OTP Relay

Gmail に届いた**認証コードだけ**を抜き出して、スマホに届けます。
スマホで Gmail にログインする必要はありません。

- **Telegram 通知**（iPhone / Android 共通）: コードがすぐ通知され、タップするとコピーできます
- **アプリ**（iOS / Android）: 複数アカウントの最近のコードを一覧で表示し、タップでコピーできます

```
Gmail A ─▶ Apps Script (A のアカウントで動く) ─┐        ┌─▶ Telegram 通知
Gmail B ─▶ Apps Script (B のアカウントで動く) ─┼────────┤
Gmail C ─▶ Apps Script (C のアカウントで動く) ─┘        └─▶ iOS / Android アプリ (API で取得)
```

| | |
|---|---|
| Gmail の権限 | `gmail.readonly`（読み取り専用。メールは既読にも変更にもなりません） |
| 確認間隔 | 1 分ごと（通知は最大 1 分ほど遅れます） |
| 外部に送る内容 | コード・送信元名・アカウント名だけ（件名や本文は送りません） |
| 費用 | 無料（Google Apps Script と Telegram Bot API の無料枠内） |

## ダウンロード

[Releases](../../releases/latest) から入手できます。

| ファイル | 内容 |
|---|---|
| `otp-relay-android.apk` | Android アプリ |
| `otp-relay-ios-unsigned.ipa` | iOS アプリ（未署名。インストール方法は下記） |
| `gmail-otp-relay-apps-script.zip` | Apps Script 一式（`Code.gs` と `appsscript.json`） |

---

## セットアップ

### 1. Telegram Bot を作る（最初の 1 回だけ）

1. Telegram で [@BotFather](https://t.me/BotFather) を開き、`/newbot` を送ります。
2. Bot の名前とユーザー名（末尾が `bot`）を決めると、**トークン**（`123456:ABC-…`）が届きます。
3. 作った Bot を開いて「開始」を押し、何かメッセージを 1 つ送っておきます（chat_id を調べるために必要です）。

### 2. Apps Script を設定する（Gmail アカウントごと）

監視したい Gmail アカウントでログインした状態で行います。

1. [script.google.com](https://script.google.com) で「新しいプロジェクト」を作ります。名前は例えば `Gmail OTP Relay`。
2. `コード.gs` の中身を全部消して、[`apps-script/Code.gs`](apps-script/Code.gs) の内容を貼り付けます。
3. 左の ⚙「プロジェクトの設定」で「`appsscript.json` マニフェスト ファイルをエディタで表示する」をオンにし、エディタに出てきた `appsscript.json` を [`apps-script/appsscript.json`](apps-script/appsscript.json) の内容に置き換えます。
4. 同じ「プロジェクトの設定」の一番下にある「スクリプト プロパティ」に `TELEGRAM_BOT_TOKEN` を追加します。
5. エディタ上部の関数選択で `showTelegramChatId` を選んで「実行」を押します。
   - 初回は承認画面が出ます。「このアプリは Google で確認されていません」と表示されたら「詳細」→「（安全ではないページ）に移動」→「許可」と進みます。自分で作ったスクリプトなので問題ありません。
   - 実行ログに `chat_id: 123456789` のように表示されます。
6. スクリプト プロパティに `TELEGRAM_CHAT_ID` を追加します。必要なら `ACCOUNT_LABEL`（例: `仕事用`）も追加します。
7. `setup` を実行します。Telegram に「✅ 監視を開始しました」と届けば完了です。

この時点で Telegram 通知が使えます。アプリも使う場合は次へ進みます。

### 3. アプリ用の API を公開する（アプリを使う場合）

1. 右上の「デプロイ」→「新しいデプロイ」→ 種類の選択（⚙）で「ウェブアプリ」を選びます。
2. 「次のユーザーとして実行」は**自分**、「アクセスできるユーザー」は**全員**にして「デプロイ」を押します。
   - 「全員」にしても、URL に含まれる 64 桁のキーを知らなければコードは読めません。
3. `sendAppLink` を実行すると、Telegram に**接続 URL** が届きます。

### 4. アプリをインストールする

**Android**

1. スマホで Releases の `otp-relay-android.apk` をダウンロードして開きます。
2. 「提供元不明のアプリ」のインストールを許可するよう求められたら許可します。

**iPhone**

App Store では配布していないため、未署名の IPA を自分の Apple ID で署名してインストールします。

1. PC に [AltStore](https://altstore.io) または [Sideloadly](https://sideloadly.io) を入れます。
2. iPhone を PC につなぎ、`otp-relay-ios-unsigned.ipa` を選んで、自分の Apple ID でインストールします。
3. iPhone の「設定 → 一般 → VPN とデバイス管理」で自分の Apple ID を信頼します。

> 無料の Apple ID で署名したアプリは 7 日ごとに再署名が必要です（AltStore なら自動で更新できます）。
> 通知だけなら Telegram で受け取れるので、iPhone ではアプリを入れなくても使えます。

### 5. アプリにアカウントを追加する

1. Telegram に届いた接続 URL を長押ししてコピーします。
2. アプリ右上の 👤 →「追加」→「クリップボードから貼り付け」→「接続して追加」を押します。

複数の Gmail アカウントを使う場合は、アカウントごとに手順 2〜3 と 5 を繰り返します。Telegram のトークンと chat_id は同じものを使えます。

---

## 設定（スクリプト プロパティ）

| 名前 | 必須 | 説明 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✔ | BotFather で発行されたトークン |
| `TELEGRAM_CHAT_ID` | ✔ | 通知先のチャット ID（`showTelegramChatId` で調べる） |
| `ACCOUNT_LABEL` | | 通知とアプリに表示するアカウント名（省略時は Gmail アドレス） |
| `INCLUDE_SENDERS` | | キーワードがなくても対象にする送信元 |
| `EXCLUDE_SENDERS` | | 常に無視する送信元（`INCLUDE_SENDERS` より優先） |
| `EXTRA_KEYWORDS` | | 判定に使うキーワードを追加（例: `ログイン用番号, 本人確認番号`） |
| `WEB_APP_URL` | | `sendAppLink` が URL を取得できない場合だけ、`…/exec` で終わる URL を設定 |

送信元・キーワードはカンマ区切りで書きます。送信元は `name@example.com` と書けばそのアドレスだけ、`example.com` と書けばそのドメインとサブドメインすべてが対象になります。

### 判定ルール

1. 送信元が `EXCLUDE_SENDERS` にあれば無視します。
2. 送信元が `INCLUDE_SENDERS` にあれば、キーワードがなくてもコードを探します。
3. それ以外は、件名か本文に「認証」「ワンタイム」「verification」「OTP」などのキーワード（`EXTRA_KEYWORDS` を含む）があるメールだけを対象にします。
4. URL・金額・日付・電話番号などを除いたうえで、キーワードに一番近い 4〜8 桁の数字を選びます。`G-123456`、`123 456`、全角数字、英数字混在のコード（`X7K2QP`）にも対応しています。

`testExtract` を実行すると、直近 10 通のメールでの判定結果をログで確認できます（通知は送りません）。

## 運用

- **止める**: `stop` を実行します。アプリの API も止めるには「デプロイを管理」からデプロイをアーカイブします。
- **完全に解除する**: Google アカウントの「セキュリティ → サードパーティ製のアプリとサービス」からこのスクリプトのアクセス権を削除します。
- **コードを更新する**: `Code.gs` を貼り替えて保存し、「デプロイを管理」→ 鉛筆アイコン →「バージョン: 新しいバージョン」で再デプロイします（接続 URL は変わりません）。
- **接続 URL が漏れた場合**: スクリプト プロパティの `API_KEY` を削除して `sendAppLink` を実行すると、新しいキーが発行されます。古い URL は使えなくなります。

## 制約

- Apps Script の時間主導トリガーは最短 1 分間隔のため、通知は最大 1 分ほど遅れます。
- 無料の Google アカウントでは、トリガーの実行時間は 1 日 90 分までです。1 回 1〜2 秒なので通常は収まります。
- Telegram の通常チャットはエンドツーエンド暗号化ではありません。コードは Telegram のサーバーを経由します。
- アプリは開いている間、15 秒ごとに更新します。バックグラウンドでの通知は Telegram が担当します。

## 開発

```bash
node apps-script/test/extract.test.js   # コード抽出のテスト
cd app && flutter test                   # アプリのテスト
```

`v*` のタグを push すると、GitHub Actions が APK と IPA をビルドして Release を作成します。
Android の署名鍵はリポジトリの Secrets（`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`）から読み込みます。

## ライセンス

MIT
