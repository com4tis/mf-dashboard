# セットアップ（自家サーバー版）

このガイドでは、ローカルPC上のDocker ComposeでWebダッシュボードとcrawlerの2サービスを常時稼働させ、Tailscale（tailnet）経由でのみアクセスできるようにする。完了すると、tailnet内の端末からダッシュボードへアクセスでき、毎日6:30と15:30（JST）の自動更新と画面上からの手動更新を利用できる。

> このガイドはupstream（[hiroppy/mf-dashboard](https://github.com/hiroppy/mf-dashboard)）の Cloudflare Tunnel + Terraform + 1Password 前提の構成を、Tailscale + 環境変数直接指定 + otpauth に置き換えた自家運用版。認証・依存関係を変更しているため、upstreamのセットアップ手順とは互換性がない。

セットアップは次の順番で進める。

1. Tailscaleを準備する
2. Money Forwardの認証情報を準備する
3. アプリの設定ファイルを作成する
4. Docker Composeを起動して動作を確認する

## 必須要件

- [Money Forward ME](https://moneyforward.com/)
- [Tailscale](https://tailscale.com/)アカウント（このホストと、アクセスする端末の両方にインストール）
- ローカルPCが常時起動できる環境
- ローカルにインストール済みのツール:
  - **Docker Desktop**（System SettingsのLogin Itemsでログイン時起動を有効化）
  - **Tailscale**（GUIアプリ、または`brew install --cask tailscale-app`）
  - `git`
  - `openssl`

リポジトリを取得し、以降のコマンドを実行するディレクトリへ移動する。fork している場合はfork先のURLに置き換える。

```sh
git clone <あなたのfork先URL> mf-dashboard
cd mf-dashboard
```

## 1. Tailscaleの準備

```sh
brew install --cask tailscale-app
open -a Tailscale
```

GUIでログイン後、IPとMagicDNS名を確認する。

```sh
tailscale ip -4
tailscale status
```

ダッシュボードへアクセスする端末（スマートフォン、ノートPC等）にもTailscaleを導入し、同一アカウントでログインする。Tailscale管理画面（[login.tailscale.com/admin](https://login.tailscale.com/admin/machines)）でMagicDNSを有効化しておくと、`https://<machine>.<tailnet>.ts.net`のような固定ホスト名でアクセスできる。

**Tailscale Funnelは使用しない。** Funnelはtailnet外のインターネットへ公開する機能であり、本構成の前提（tailnet内のみに公開）と矛盾する。

## 2. Money Forwardの準備

- Money Forward MEのログインメールアドレスとパスワードを確認する
- 二段階認証を使う場合は「認証アプリ」方式を有効化する（メール認証は無人クロールでは自動処理できないため非対応）
  - MoneyForward MEのセキュリティ設定で認証アプリを有効化し、QRコード付近の「シークレットキーを表示」等のリンクからBase32シード（英数字の文字列）を取得する
  - このシードをパスワードマネージャー（TOTP項目）と、後述の`.env`の`MF_TOTP_SECRET`の両方に登録する
  - MoneyForward側の確認コード入力を完了し、認証アプリ方式を確定する。メール認証が並行して有効なままの場合は無効化する

## 3. セットアップ

### 3.1 アプリ設定

`.env`を作成する。

```sh
cp .env.example .env
openssl rand -hex 32
chmod 600 .env
```

次の値を`.env`へ設定する。

```dotenv
MF_USERNAME=<Money Forward MEのログインメールアドレス>
MF_PASSWORD=<Money Forward MEのパスワード>
MF_TOTP_SECRET=<認証アプリのBase32シード。二段階認証未使用なら空欄>
REFRESH_TOKEN=<openssl rand -hex 32の出力>
TRUSTED_PROXY_AUTH=true
DASHBOARD_URL=https://<machine>.<tailnet>.ts.net
```

| `.env`のキー                                 | 必須 | 内容                                                                                                         |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------ |
| `MF_USERNAME`                                | 必須 | Money Forward MEのログインメールアドレス                                                                     |
| `MF_PASSWORD`                                | 必須 | Money Forward MEのパスワード                                                                                 |
| `MF_TOTP_SECRET`                             | 任意 | 二段階認証（認証アプリ方式）のBase32シード。空白・大文字小文字は正規化されるためそのまま貼ってよい           |
| `REFRESH_TOKEN`                              | 必須 | crawlerとwebが共有する内部API用Bearerトークン                                                                |
| `TRUSTED_PROXY_AUTH`                         | 必須 | `true`固定文字列一致でCloudflare Access検証をバイパスする。前段にTailscale等の認証がある場合のみ`true`にする |
| `DASHBOARD_URL`                              | 必須 | Open Graph / Twitter metadataと通知に使う公開ダッシュボードURL                                               |
| `AI_PROVIDER` / `AI_MODEL` / `AI_API_KEY`    | 任意 | 財務インサイト、家計AIチャット、LLMカテゴリ推論。利用する機能では3項目すべて必須                             |
| `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID`       | 任意 | Slack通知                                                                                                    |
| `DISCORD_WEBHOOK_URL` / `DISCORD_AVATAR_URL` | 任意 | Discord通知                                                                                                  |
| `AUTH_STATE_PATH`                            | 任意 | ローカル実行時のブラウザーセッション保存先。Docker Composeでは設定しない                                     |

**`TRUSTED_PROXY_AUTH`は`"true"`以外の値（`1`、`TRUE`、空文字など）ではバイパスされない厳密一致。** また、このフラグを`true`にする場合、`compose.yml`のポートは`127.0.0.1`等の信頼できるネットワークにのみバインドし、`0.0.0.0`で全ネットワークへ公開してはならない（後述のTailscale経由アクセスを参照）。

### 3.2 Docker Composeの起動

ビルド前にComposeの設定を検証する。

```sh
docker compose config --quiet
docker compose build web
docker compose build crawler
docker compose up -d
```

`docker compose config --quiet`が何も表示せず終了すれば、Composeが必要とする環境変数は設定済みである。`required variable ... is missing a value`と表示された場合は、メッセージに示されたキーが`.env`に存在し、`=`の右側が空でないことを確認する。

イメージは`web`と`crawler`を個別にビルドすることを推奨する（同時ビルドはメモリを圧迫しやすいため）。

以降はcrawlerコンテナ内のsupercronicが`crontab`のスケジュールで自動更新する。

各コンテナの役割は次のとおり。

- **web**: ダッシュボードを配信し、共有データベースを読み取る。`127.0.0.1:8765`にのみバインドされる
- **crawler**: 定期更新と手動更新を受け付け、取得したデータを共有データベースへ保存する（外部非公開）

スケジュールを変更する場合は`docker/crawler/crontab`を編集し、`docker compose build crawler`でcrawlerを再ビルドする。

### 3.3 Tailscale経由での公開

`web`は`127.0.0.1:8765`にのみバインドされているため、tailnet内から到達させるには`tailscale serve`を使う。

```sh
tailscale serve --bg --https=443 http://127.0.0.1:8765
tailscale serve status
```

これにより、tailnet内の端末から`https://<machine>.<tailnet>.ts.net`でアクセスできる。HTTPS証明書はTailscaleが自動発行する。

**`tailscale funnel`は絶対に使用しない。** funnelはtailnet外のインターネットへ公開する機能であり、本構成の前提（tailnet内限定公開）に反する。

### 3.4 動作確認

```sh
docker compose ps
docker compose logs -f
```

以下を確認する:

- `docker compose ps`で`web`と`crawler`の2サービスが`Up`になっている（`cloudflared`は存在しない）
- ログに認証エラーがない
- tailnet内の端末から`https://<machine>.<tailnet>.ts.net`へアクセスするとダッシュボードが表示される
- **Tailscaleを使わない同一LAN上の端末からは、同じアドレスに到達できない**（`127.0.0.1`バインドの効果を確認する重要な検証）

```sh
# Tailscale切断状態の別端末から実行し、接続拒否されることを確認する
curl -I http://<Mac miniのLAN IP>:8765
```

## 4. 運用

- **ホストを再起動する**: Docker Desktopの自動起動後、`restart: unless-stopped`を設定した各コンテナも自動復帰する。`tailscale serve`の設定はTailscaleデーモン側に保持されるため再設定不要
- **イメージを再ビルドする**: `docker compose build && docker compose up -d`
- **crawlerをすぐに実行する**: `docker compose exec crawler pnpm --filter @mf-dashboard/crawler start`
- **webの表示だけを更新する**: `docker compose exec crawler sh -c 'curl -fsS -X POST -H "Authorization: Bearer ${REFRESH_TOKEN}" "http://web:8765${NEXT_PUBLIC_BASE_PATH}/api/refresh/"'`
- **upstreamの更新を取り込む**（MoneyForwardのDOM変更対応等）: `git fetch upstream && git rebase upstream/main`（forkに`upstream`リモートを登録している場合）

## 5. オプション設定

ここからの設定は、基本セットアップの完了後に必要なものだけ追加する。

### Slack通知

1. [Slack API](https://api.slack.com/apps)でBotを作成し、`xoxb-`から始まるトークンを発行する
2. Botへ`chat:write`権限を付与し、投稿先チャンネルへ招待する
3. `.env`の`SLACK_BOT_TOKEN`と`SLACK_CHANNEL_ID`を設定する

### Discord通知

1. 通知先チャンネルの「連携サービス」からIncoming Webhookを作成する
2. `.env`の`DISCORD_WEBHOOK_URL`へ、発行された`https://discord.com/api/webhooks/...`形式のURLを設定する

### 財務インサイトと家計AIチャット

財務インサイトと家計AIチャットを利用する場合は、`.env`に次の3項目を設定する。いずれかが空の場合、財務インサイトは生成されず、チャットUIも表示されない。

```dotenv
AI_PROVIDER=google
AI_MODEL=gemini-2.5-flash
AI_API_KEY=<provider-api-key>
```

- `AI_PROVIDER`: `openai`、`anthropic`、`google`のいずれか
- `AI_MODEL`: 選択したプロバイダーで利用可能なモデルID
- `AI_API_KEY`: 選択したプロバイダーのAPIキー。ブラウザーへは公開せず、`.env`だけに保存する

ローカルでデモデータを使って確認する場合は、リポジトリルートで次を実行する。

```sh
pnpm install
pnpm --filter @mf-dashboard/db build:demo
DB_PATH=../../data/demo.db pnpm --filter @mf-dashboard/web dev
```

`pnpm build:demo`で生成する静的な公開デモにはAPI routeが含まれないため、家計AIチャットの確認には使用しない。

Docker Composeで設定を反映する場合は、webイメージを再ビルドして起動する。

```sh
docker compose build web
docker compose up -d web
```

起動後、ダッシュボード右下の「家計AIチャットを開く」ボタンを選び、質問を入力して送信する。チャットは現在のDrizzleスキーマから利用可能なテーブルとカラムを取得し、選択中のグループへread-only SQLを実行する。回答は本文として表示され、ユーザーが画面表示や遷移先を明示的に求めた場合だけ、検証済みのダッシュボード内部リンクを含む。該当データがない場合は、条件を勝手に変更したり金額を推測したりしない。

チャットの質問と、回答に必要な家計データは設定したAIプロバイダーへ送信される。会話はブラウザーのストレージへ保存されないが、AIプロバイダー側のデータ取扱方針を確認し、送信を許可できる場合だけ有効にする。本番環境では、Tailscale等の前段認証を経由した利用者だけがダッシュボードへアクセスできる構成を維持する。

回答生成に失敗した場合はチャット内にエラーが表示される。まず3つのAI環境変数、APIキーの権限・利用上限、モデルIDを確認する。家計データが未取得の場合はcrawlerを実行してから再度質問する。

従来のMCPサーバーとAIクライアント側のMCPセットアップは廃止済み。家計データの照会にはWebアプリ内の家計AIチャットを使用する。

### 未分類取引のカテゴリ決定

`data/category-rules.json`を作成すると、crawlerはデータベースへ保存する前に、新規の未分類取引へカテゴリを設定する。ファイルが存在しない場合、この機能は無効になり、取引を未分類のまま保存する。

```sh
cp data/category-rules.example.json data/category-rules.json
```

設定例:

```json
{
  "llm": {
    "enabled": false,
    "maxPerRun": 5,
    "minConfidence": 0.65
  },
  "rules": [
    {
      "accountName": "テスト口座",
      "category": "食費",
      "subCategory": "食料品"
    },
    {
      "descriptionContains": "動画サービス",
      "category": "趣味・娯楽",
      "subCategory": "動画・音楽"
    }
  ]
}
```

#### 固定ルール

- 対象は「新規」「未分類」「非振替」「計算対象」の取引のみ
- `accountName`は取引の口座名と完全一致する
- `descriptionContains`は取引内容と部分一致する
- 両方を指定した場合は、両条件に一致する取引だけを対象にする
- 固定ルールに一致した場合はそのカテゴリを優先し、LLMを呼び出さない
- `category`または`subCategory`がMoney Forward MEの候補に存在しない場合、そのルールを採用しない

#### LLMによる推論

固定ルールに一致しなかった取引だけをLLMで推論する場合は、`llm.enabled`を`true`へ変更し、`.env`に`AI_PROVIDER`、`AI_MODEL`、`AI_API_KEY`を設定する。

- Money Forward MEから取得した候補カテゴリの中から選択し、カテゴリIDは生成しない
- 1回の実行件数は`llm.maxPerRun`で制限する。既定値は`5`
- 推論結果の確信度が`llm.minConfidence`未満の場合は反映しない。既定値は`0.65`
- 取引の日付、種別、金額、内容、候補カテゴリのIDと名称を外部プロバイダーへ送信する
- 更新に失敗してもcrawlerは停止せず、対象取引を未分類のまま保存する

採用したカテゴリはMoney Forward MEの`/cf/update`へ反映する。その後、対象月を再取得してデータベースへ保存する。外部プロバイダーへ取引情報を送信してよい場合だけ、LLMによる推論を有効にする。
