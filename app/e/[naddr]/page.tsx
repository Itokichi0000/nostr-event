import { redirect } from "next/navigation";
import { nip19 } from "nostr-tools";
import { KIND_DATE_EVENT, KIND_TIME_EVENT } from "@/lib/nostr/nip52";
import { getEventByCoordinate, isPubliclyVisible } from "@/lib/services/events";
import { ExternalEvent } from "./external-event";

export const dynamic = "force-dynamic";

// NIP-19 naddr の共有リンク。Gather 管理のイベントならアプリ内詳細へ、それ以外はリレーから読み取り表示
export default async function NaddrPage({ params }: { params: Promise<{ naddr: string }> }) {
  const { naddr } = await params;
  let decoded: nip19.AddressPointer | null = null;
  try {
    const r = nip19.decode(decodeURIComponent(naddr).replace(/^nostr:/, ""));
    if (r.type === "naddr") decoded = r.data;
  } catch {
    decoded = null;
  }
  if (!decoded || (decoded.kind !== KIND_DATE_EVENT && decoded.kind !== KIND_TIME_EVENT)) {
    return <ExternalEvent pointer={null} />;
  }
  const e = await getEventByCoordinate(decoded.kind, decoded.pubkey, decoded.identifier);
  if (e && isPubliclyVisible(e)) redirect(`/events/${e.slug}`);
  return <ExternalEvent pointer={{ kind: decoded.kind, pubkey: decoded.pubkey, identifier: decoded.identifier, relays: decoded.relays ?? [] }} />;
}
