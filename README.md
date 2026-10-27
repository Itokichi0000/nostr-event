# Gather（仮称）— Nostr イベント管理

「イベントを作る、参加する、迎える」を一つの画面で。主催者はタイトル・日時・場所だけでイベントを公開し（NIP-52）、参加者は Nostr またはゲストで申込み、当日は QR で受付できます。新規申込・チェックインはアプリ内通知と Web Push で主催者に届きます。

- 仕様: [`PRD.md`](PRD.md)（最上位仕様）、開発ルール: [`CLAUDE.md`](CLAUDE.md)
- 実装計画と進捗: [`docs/implementation-plan.md`](docs/implementation-plan.md)
- 設計判断の記録: [`docs/decisions.md`](docs/decisions.md)

## 構成

```
ブラウザー / PWA ──署名(NIP-07 / NIP-46)──> 署名器（秘密鍵はここだけ）
   │ 署名済みイベント・API・5秒ポーリング
   ▼
Next.js (Web + API)  ──>  PostgreSQL  <──  常駐ワーカー (worker/)
                                            ├ outbox: リレー公開 / Web Push / プロフィール・NIP-65 取得
                                            └ リレー監視: 外部 RSVP・外部更新のバックフィル
```

| 層 | 採用 |
|---|---|
| Web / API | Next.js 16 (App Router) + React 19 + TypeScript 5.9 |
| UI | Tailwind CSS v4 + shadcn/ui 方式の自前部品 + lucide-react |
| Nostr | nostr-tools 2.25（NIP-01/07/19/46/52/65/98） |
| DB | PostgreSQL 16 + Drizzle ORM / drizzle-kit |
| 通知 | DB 通知 + 5秒ポーリング、Web Push（web-push + Service Worker + VAPID） |
| テスト | Vitest（単体・結合、実 PostgreSQL）、Playwright（E2E、PC + スマホ幅） |

バージョンは `package.json` で完全固定しています。

## ローカルで動かす

前提: Node.js 22 以上、pnpm 10、PostgreSQL 16（Docker でも可）

```bash
pnpm install
cp .env.example .env

# DB（Docker を使う場合）— gather / gather_test / gather_e2e を作成
docker compose up -d

pnpm db:migrate          # マイグレーション
pnpm vapid               # 出力された VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY を .env に追記

# 3つのプロセスを別々のターミナルで
pnpm relay:dev           # 開発用 Nostr リレー ws://localhost:7777（メモリのみ。外部に公開しない）
pnpm worker              # 常駐ワーカー
pnpm dev                 # http://localhost:3000

pnpm db:seed             # （任意）サンプルイベント
```

ログインにはブラウザーの NIP-07 拡張（Alby、nos2x など）か、NIP-46 署名アプリ（Amber、nsec.app など）が必要です。`nsec` を貼り付ける画面はありません。

> **APP_URL について**: NIP-98 の `u` タグ検証・チケット URL・Origin チェックに使います。ブラウザーで開く URL と一致させてください（例: `http://localhost:3000`）。

### ブラウザーで確認する流れ

1. `http://localhost:3000/create` でタイトル・日時・場所を入力 → 「公開する」→ 拡張でログイン・署名
2. 管理画面（`/dashboard/events/<id>`）に「公開しました」と共有リンク。「リレーごとの公開状況」で `ws://localhost:7777` への ACK を確認
3. 別のブラウザー（またはシークレットウィンドウ）でイベントページを開き「ゲストとして申込む」→ チケット（QR）を表示
4. 主催者画面に通知（ベル・トースト）が5秒以内に届き、参加確定数が増える
5. 「カメラでQRを読み取る」でチケットの QR を読む（またはチケット URL を貼り付け）→「○○さん、受付完了」。もう一度読むと「受付済み」
6. `/settings` で「通知を受け取る」をオンにすると、アプリを閉じていても Web Push が届く（「テスト通知を送る」で確認可）

当日受付は「開始2時間前〜終了2時間後」のみ可能です。動作確認では開始時刻を近い時間にしてください。

## 環境変数

| 変数 | 必須 | 説明 |
|---|---|---|
| `APP_URL` | ✓ | 公開 URL（末尾スラッシュなし） |
| `DATABASE_URL` | ✓ | PostgreSQL |
| `TEST_DATABASE_URL` | テスト | `pnpm test` 用（実行のたびに TRUNCATE されます） |
| `E2E_DATABASE_URL` | E2E | `pnpm test:e2e` 用（同上） |
| `NOSTR_FALLBACK_RELAYS` | ✓ | 主催者の NIP-65 書込リレーに加えて使うリレー（2〜4推奨、カンマ区切り） |
| `NOSTR_INDEX_RELAYS` | | NIP-65 / プロフィール取得用（省略時はフォールバックと同じ） |
| `NEXT_PUBLIC_NIP46_RELAYS` | | スマホ署名アプリとの接続に使うリレー（ビルド時に埋め込み） |
| `NEXT_PUBLIC_NOSTR_READ_RELAYS` | | Gather 外の naddr を表示するときの読み取りリレー |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Push | `pnpm vapid` で生成。未設定でもアプリ内通知は動作 |
| `UPLOAD_DIR` | | 画像保存先（開発用ローカルディスク） |

## コマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Web |
| `pnpm worker` | 常駐ワーカー（本番も別プロセスで起動） |
| `pnpm relay:dev` | 開発用リレー |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:seed` | スキーマ変更・適用・サンプル |
| `pnpm lint` / `pnpm typecheck` | 静的検査 |
| `pnpm test` | 単体 + 結合テスト（`TEST_DATABASE_URL` の PostgreSQL が必要。外部リレー不要） |
| `pnpm test:e2e` | ビルド → 開発用リレー・ワーカー・Web を起動して Playwright（`E2E_DATABASE_URL` が必要） |

### テストで確認していること

- NIP-52: 31923 の `title/start/end/D/start_tzid`、UTC 日跨ぎの複数 `D`、31922 の排他 `end`・年跨ぎ、RSVP 31925 の `a/d/status/p`、取消で同じ `d`、`name`・`L/l` を使わない
- NIP-98: 偽署名・改ざん・期限切れ・誤 URL・誤メソッド・誤 kind・payload・リプレイを拒否
- 定員10に20件同時申込 → `confirmed` 10件／残り `waitlisted`。同一 Nostr ユーザーの同時二重申込、idempotency key の再送
- 承認制での定員再検証、キャンセル → 先着順の繰り上げ（同時キャンセルでも定員超過なし）
- QR: 1回目受付・2回目「受付済み」（件数・通知とも増えない）、同時スキャン、別イベント・失効・未確定・期間外、他人のイベントへの受付拒否
- 通知: dedupe、Push は端末単位で二重送信なし・410 で購読削除・5xx は未配送端末だけ再試行、outbox の多重ワーカー・ロック残り回復
- リレー: 一部失敗で partial → 再試行で success（成功済みリレーには再送しない）、全失敗で failed + 主催者警告、編集は同じ座標で置換
- 外部 RSVP: 複数リレーから同じイベント → 1件・通知1回、定員を消費しない、アプリ申込済み本人は連携済み、古い再送は無視、なりすまし更新は無視
- プライバシー: ゲスト名・メール・チケット URL がリレーに出ない、限定リンクは Nostr に一切投稿しない
- E2E（PC・スマホ幅）: 作成 → NIP-52 署名・リレー公開 → ゲスト申込 → 主催者通知 → 受付 → 受付通知、Nostr 参加者の公開 RSVP は明示的に選んだときだけ

## デプロイ

Web とワーカーの **2プロセス** 構成です（リレー購読はサーバーレス関数に置けないため）。Railway / Fly.io / Render などで:

1. マネージド PostgreSQL を用意し `DATABASE_URL` を設定
2. Web: `pnpm install --frozen-lockfile && pnpm build && pnpm db:migrate && pnpm start`
3. Worker: `pnpm install --frozen-lockfile && pnpm worker`（同じ環境変数。複数台起動しても outbox は `FOR UPDATE SKIP LOCKED` で重複処理しません）
4. `APP_URL` を https の公開 URL に（Cookie に `Secure` が付きます）。`NOSTR_FALLBACK_RELAYS` を実在の `wss://` リレーに
5. 逆プロキシ配下では `X-Forwarded-For` をクライアント IP として使います（レート制限）
6. 画像を複数台で共有する場合は `lib/storage/images.ts` を S3 互換ストレージ実装に差し替え（未実装）

ヘルスチェック: `GET /api/health`

## セキュリティ・プライバシー

- 秘密鍵はサーバー・DB・ログ・ブラウザーストレージに保存しません。署名はすべて利用者の署名器で行い、サーバーは署名済みイベントの検証・保存・再送のみ
- セッション・チケットは 32byte CSPRNG、DB には SHA-256 ハッシュのみ。Cookie は `HttpOnly; SameSite=Lax`（https では `Secure`）
- 書込 API はすべて Origin 検査 + サーバー側の本人・所有者確認 + Zod 検証
- QR はチケット URL（トークン）のみで個人情報を含みません。`Referrer-Policy: no-referrer`、外部スクリプトなしの CSP、チケットページは `no-store` / `noindex`
- Push 本文は「新しい参加申込がありました」等の定型文のみ（氏名・メールを含めない）
- Nostr に公開した情報は全世界からの削除を保証できません（画面でも明示）

## 実装状況と制約

実装済みの範囲は [`docs/implementation-plan.md`](docs/implementation-plan.md) を参照。現時点の主な制約:

- **NIP-46**: `bunker://` と `nostrconnect://`（QR / ディープリンク）を実装済みだが、実機の署名アプリでの相互運用テストは未実施
- **画像**: ローカルディスク保存のみ（S3 互換は未実装）
- **CAPTCHA / Turnstile**: 未実装（ゲスト申込はレート制限のみ）
- **NIP-09 削除リクエスト**: 未実装（中止は `status=cancelled` タグ付き更新で表現）
- **受付期間の変更 UI**: DB 列（`checkin_open_at` / `checkin_close_at`）はあるが画面は未提供
- **個人情報の90日削除バッチ**: 未実装（既読通知の30日削除のみ）
- **Web Push の実配送**: ロジックはモック送信器でテスト済み。実ブラウザー・iOS 実機での受信は未確認
- メール送信は行いません（ゲストのメールは任意入力・未検証）
