import type { BrowserContext, Page } from "@playwright/test";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";

/**
 * テスト用の NIP-07 署名器を注入する。秘密鍵はテストプロセス（Node）側にだけあり、
 * ブラウザーには window.nostr のインターフェースだけを公開する。
 */
export async function installNostrSigner(context: BrowserContext) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const signed: EventTemplate[] = [];
  await context.exposeFunction("__e2eGetPublicKey", () => pubkey);
  await context.exposeFunction("__e2eSignEvent", (t: EventTemplate) => {
    signed.push(t);
    return { ...finalizeEvent(t, sk) };
  });
  await context.addInitScript(() => {
    const w = window as unknown as {
      nostr: unknown;
      __e2eGetPublicKey: () => Promise<string>;
      __e2eSignEvent: (t: unknown) => Promise<unknown>;
    };
    w.nostr = { getPublicKey: () => w.__e2eGetPublicKey(), signEvent: (t: unknown) => w.__e2eSignEvent(t) };
  });
  return { pubkey, signed };
}

export function jst(offsetMin: number) {
  const d = new Date(Date.now() + offsetMin * 60_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** ヘッダーのログインボタン（またはフォームの公開時）に出るダイアログで拡張ログイン */
export async function loginViaDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /ブラウザー拡張でログイン/ }).click();
  await dialog.waitFor({ state: "detached" });
}
