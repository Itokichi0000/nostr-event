# Gather 実装計画

`PRD.md` を最上位仕様とし、Phase 0→4 の順で実装する。各 Phase 終了時に `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` を実行する。

## 全体構成

```
ブラウザー/PWA ──署名(NIP-07/46)──> 署名器
    │  署名済イベント / API / 5秒ポーリング
    ▼
Next.js (app/ + app/api)  ──> PostgreSQL <── 常駐ワーカー (worker/)
                                         ├─ outbox: リレー公開・Web Push・プロフィール取得
                                         └─ リレー監視: 外部RSVP・外部更新のバックフィル
```

- Next.js の API はリレーに WebSocket 接続しない。リレー送受信はすべてワーカー。
- 状態遷移と `notifications` / `outbox_jobs` は同一トランザクションで書く。

## 依存関係

```
Phase 0 (基盤)
  └─> Phase 1 (認証・NIP-52公開)  ← nip52 codec / nip98 / session / outbox / relay publish
        └─> Phase 2 (申込)        ← registrations / tickets / 定員トランザクション / RSVP
              └─> Phase 3 (受付・通知) ← checkins / notifications / push / service worker
                    └─> Phase 4 (E2E・仕上げ)
```

## Phase 0 — 開発基盤

- [x] pnpm / Next.js App Router / TypeScript strict / Tailwind v4
- [x] 共通UI（shadcn/ui 方式の自前コンポーネント: Button, Card, Input, Badge 等）
- [x] Docker Compose (PostgreSQL 16)、`.env.example`
- [x] Drizzle スキーマ + migration（`drizzle/`）、`pnpm db:migrate`
- [x] i18n 構造（ja 標準 / en 切替）
- [x] Vitest / Playwright / ESLint 設定
- [x] ローカル開発用 Nostr リレー（`pnpm relay:dev`）、シードデータ

## Phase 1 — Nostrログインとイベント公開

- [x] 署名器インターフェース（NIP-07 / NIP-46 bunker:// / nostrconnect://）
- [x] NIP-98 検証（kind, created_at ±60s, u, method, 署名, リプレイ）→ HttpOnly セッション
- [x] Origin 検査（CSRF）、セッションはハッシュ保存
- [x] NIP-52 codec（31922/31923 生成・解析、`D` タグ、終日 end exclusive、RSVP 31925）
- [x] イベント作成（ドラフト → 署名 → 公開）、限定リンク、編集、キャンセル
- [x] 署名済イベント検証・保存、`relay_publish_attempts` でリレー単位追跡
- [x] ワーカー: outbox（`FOR UPDATE SKIP LOCKED`、指数バックオフ、LISTEN/NOTIFY）、リレー公開、NIP-65 取得
- [x] 画面: `/`（検索）, `/create`, `/events/[slug]`, `/e/[naddr]`, `/dashboard`, 編集

## Phase 2 — 正式参加登録

- [x] Nostr 申込 / ゲスト申込（表示名必須・メール任意）
- [x] 定員・自動/手動承認・キャンセル待ち（イベント行 `FOR UPDATE` で直列化）
- [x] idempotency key、`(event_id, nostr_pubkey)` 一意
- [x] チケット発行（32byte CSPRNG、SHA-256 ハッシュ保存）、ローテーション
- [x] 申込キャンセル → 先着順の繰り上げ
- [x] 主催者の承認 / 却下
- [x] NIP-52 RSVP の任意公開（明示同意・デフォルトOFF・同一 d 再利用）
- [x] ワーカー: 外部 RSVP 監視・バックフィル・集約（定員を消費しない）
- [x] レート制限（ゲスト申込・ログイン・チェックイン）

## Phase 3 — チェックインと通知

- [x] QR チェックイン（カメラ / BarcodeDetector + jsQR フォールバック）、手動・検索受付
- [x] `checkins.registration_id` UNIQUE で二重受付防止、受付期間検証
- [x] 通知レコード（`dedupe_key` UNIQUE）、未読数、既読、カーソルページング
- [x] 5秒ポーリング（ベル・トースト）
- [x] Web Push（VAPID、Service Worker、端末登録/解除、無効購読削除、再試行、端末単位の重複配信防止）
- [x] PWA manifest、iOS ホーム画面追加ガイド

## Phase 4 — E2E・仕上げ

- [x] 同時申込（定員10に20件）テスト、NIP 仕様テスト、認可テスト
- [x] Playwright: 作成 → 申込 → 受付 → 主催者通知
- [x] 空状態・読み込み・エラー・再試行
- [x] README（環境変数・migration・起動・ワーカー・テスト・デプロイ）

## 進捗ログ

各 Phase の結果は README の「実装状況」と `docs/decisions.md` に記録する。
