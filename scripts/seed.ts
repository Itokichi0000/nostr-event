// 開発用サンプルデータ。サンプル主催者の鍵はこのスクリプト内で生成して署名に使い、保存しない。
// 使い方: pnpm relay:dev / pnpm worker を起動した状態で pnpm db:seed
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { closeDb, getDb } from "../lib/db/client";
import { eq } from "drizzle-orm";
import { accounts, events } from "../lib/db/schema";
import type { SignedEvent } from "../lib/nostr/nip52";
import { createEvent, publishEvent } from "../lib/services/events";
import { register } from "../lib/services/registrations";

const pad = (n: number) => String(n).padStart(2, "0");
function day(offset: number) {
  const d = new Date(Date.now() + offset * 86400_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function main() {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const [acc] = await getDb().insert(accounts).values({ nostrPubkey: pubkey, displayName: "Gather サンプル主催者" }).returning();
  const actor = { sessionId: "seed", accountId: acc!.id, pubkey, displayName: acc!.displayName, picture: null };

  const samples = [
    {
      title: "Nostr はじめての勉強会",
      summary: "鍵の管理からクライアントの選び方まで、初心者向けに解説します",
      description: "Nostr をこれから始める方向けの勉強会です。\n\n・Nostr とは\n・鍵の安全な管理\n・おすすめクライアント\n\n質問タイムもあります。",
      location: "東京都渋谷区 コワーキングスペース",
      hashtags: ["nostr", "beginner"],
      startDate: day(5),
      startTime: "19:00",
      endDate: day(5),
      endTime: "21:00",
      capacity: 30,
      guests: ["佐藤", "鈴木", "高橋", "田中"],
    },
    {
      title: "ビットコイン・ミートアップ大阪",
      summary: "ゆるく交流するミートアップ",
      description: "軽食あり。Lightning の話をしましょう。",
      location: "大阪市北区",
      hashtags: ["bitcoin", "meetup"],
      startDate: day(12),
      startTime: "18:30",
      endDate: day(12),
      endTime: "21:30",
      capacity: 2,
      guests: ["伊藤", "渡辺", "山本"],
    },
    {
      title: "オンライン もくもく会",
      summary: "各自の作業を進める会",
      description: "https://meet.example.com/mokumoku",
      location: "オンライン",
      hashtags: ["online"],
      startDate: day(2),
      startTime: "20:00",
      endDate: day(2),
      endTime: "22:00",
      capacity: null,
      guests: [],
    },
  ];

  for (const s of samples) {
    const { guests, ...input } = s;
    const { event, template } = await createEvent(actor, { ...input, timezone: "Asia/Tokyo", visibility: "public_nostr" });
    await publishEvent(actor, event.id, finalizeEvent(template!, sk) as SignedEvent);
    // リレーへの送信はワーカーが行う。サンプルはワーカー未起動でも一覧に出るよう公開済みにしておく
    await getDb().update(events).set({ status: "published" }).where(eq(events.id, event.id));
    for (const g of guests) {
      await register(event.id, { mode: "guest", displayName: g, idempotencyKey: randomUUID() }, null);
    }
    console.log(`作成: ${s.title} → ${process.env.APP_URL ?? "http://localhost:3000"}/events/${event.slug}`);
  }
}

main()
  .then(() => closeDb())
  .catch(async (e) => {
    console.error(e);
    await closeDb();
    process.exit(1);
  });
