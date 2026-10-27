// リレーとの WebSocket 通信（ワーカー専用。Next.js の API からは使わない）
import { Relay, useWebSocketImplementation as setRelayWebSocket } from "nostr-tools/relay";
import { SimplePool, useWebSocketImplementation as setPoolWebSocket } from "nostr-tools/pool";
import WebSocket from "ws";
import type { SignedEvent } from "@/lib/nostr/nip52";

setRelayWebSocket(WebSocket);
setPoolWebSocket(WebSocket);

export type RelayPublisher = (relayUrl: string, event: SignedEvent) => Promise<void>;

/** 1リレーへ送信し OK true を待つ。OK false / タイムアウトは例外 */
export const publishToRelay: RelayPublisher = async (relayUrl, event) => {
  const relay = await Relay.connect(relayUrl, { timeout: 5000 });
  relay.publishTimeout = 8000;
  try {
    await relay.publish(event);
  } finally {
    relay.close();
  }
};

export function createPool(): SimplePool {
  return new SimplePool({ enablePing: true, enableReconnect: true });
}
