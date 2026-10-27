// 主要フロー: イベント作成（NIP-52 署名・リレー公開）→ ゲスト申込 → 主催者通知 → QR受付 → 受付通知
import { expect, test } from "@playwright/test";
import { SimplePool, useWebSocketImplementation as setWebSocket } from "nostr-tools/pool";
import WebSocket from "ws";
import { E2E_ENV } from "../../playwright.config";
import { installNostrSigner, jst, loginViaDialog } from "./helpers";

setWebSocket(WebSocket);

test("作成 → 申込 → 通知 → チェックイン → 受付通知", async ({ browser }, testInfo) => {
  const suffix = testInfo.project.name;
  const title = `E2E 勉強会 ${suffix} ${Date.now()}`;
  const guestName = `山田 ${suffix}`;

  // ---- 主催者: Nostr（NIP-07）でログインしてイベントを公開 ----
  const orgCtx = await browser.newContext();
  const org = await installNostrSigner(orgCtx);
  const orgPage = await orgCtx.newPage();
  await orgPage.goto("/create");
  await orgPage.getByLabel("イベント名").fill(title);
  // 受付期間内（開始30分後）に設定
  const start = jst(30);
  const end = jst(150);
  await orgPage.locator("#f-startDate").fill(start.date);
  await orgPage.locator("#f-startTime").fill(start.time);
  if (end.date !== start.date) {
    await orgPage.getByText("終了日").first().click();
    await orgPage.locator("#f-endDate").fill(end.date);
  }
  await orgPage.locator("#f-endTime").fill(end.time);
  await orgPage.getByLabel("場所").fill("東京都渋谷区");
  await expect(orgPage.getByText("Nostr 上で誰でも閲覧・再配布できます")).toBeVisible();
  await orgPage.getByRole("button", { name: /公開する/ }).click();
  await loginViaDialog(orgPage);

  await orgPage.waitForURL(/\/dashboard\/events\/[0-9a-f-]+\?created=1/);
  const eventId = orgPage.url().match(/events\/([0-9a-f-]+)/)![1]!;
  // NIP-98 認証 と NIP-52 (31923) の署名が行われた
  expect(org.signed.map((s) => s.kind)).toEqual([27235, 31923]);
  const nip52 = org.signed[1]!;
  expect(nip52.tags.find((t) => t[0] === "title")?.[1]).toBe(title);
  expect(nip52.tags.some((t) => t[0] === "D")).toBe(true);

  // ワーカーがリレーへ公開 → published
  await orgPage.locator("summary", { hasText: "リレーごとの公開状況" }).click();
  await expect(orgPage.getByText("Nostr に公開済み")).toBeVisible({ timeout: 20_000 });
  const eventUrl = await orgPage.locator(".font-mono").first().textContent();
  expect(eventUrl).toContain("/events/");
  const slugPath = new URL(eventUrl!).pathname;

  // ---- ゲスト: ログインせずに閲覧・申込 ----
  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(slugPath);
  await expect(guest.getByRole("heading", { name: title })).toBeVisible();
  await guest.getByRole("button", { name: "ゲストとして申込む" }).click();
  await guest.getByLabel("お名前（表示名）").fill(guestName);
  await guest.getByRole("button", { name: "申込む", exact: true }).click();
  await expect(guest.getByTestId("registration-result")).toHaveText("参加が確定しました");
  await expect(guest.getByText("このチケットURLが本人確認になります")).toBeVisible();
  await guest.getByRole("button", { name: "チケットを表示" }).click();
  await guest.waitForURL(/\/ticket\//);
  const ticketUrl = guest.url();
  await expect(guest.getByTestId("ticket-qr")).toBeVisible();
  await expect(guest.getByText(guestName)).toBeVisible();

  // ---- 主催者: 新規申込のアプリ内通知（5秒ポーリング）と集計 ----
  await expect(orgPage.getByTestId("stat-confirmed")).toContainText("1", { timeout: 15_000 });
  await orgPage.goto("/notifications");
  await expect(orgPage.getByTestId("notification-list")).toContainText("新しい参加申込がありました");

  // ---- 主催者: 受付（QRの内容＝チケットURLを読み取った想定で入力）----
  await orgPage.goto(`/dashboard/events/${eventId}/checkin`);
  await orgPage.getByLabel("QRの内容・チケットURLを貼り付け").fill(ticketUrl);
  await orgPage.getByRole("button", { name: "受付する" }).click();
  await expect(orgPage.getByTestId("checkin-result")).toContainText(`${guestName}さん、受付完了`);
  // 2回目は受付済み（件数は増えない）
  await orgPage.waitForTimeout(2000);
  await orgPage.getByLabel("QRの内容・チケットURLを貼り付け").fill(ticketUrl);
  await orgPage.getByRole("button", { name: "受付する" }).click();
  await expect(orgPage.getByTestId("checkin-result")).toContainText("受付済み");
  await expect(orgPage.getByTestId("checkin-count")).toContainText("受付 1 / 参加確定 1");

  // ---- 主催者: チェックイン通知 ----
  await orgPage.goto("/notifications");
  await expect(orgPage.getByTestId("notification-list")).toContainText("参加者がチェックインしました");

  // ---- 参加者: チケットに受付済みが反映 ----
  await guest.reload();
  await expect(guest.getByText(/受付済み/).first()).toBeVisible();

  // ---- リレー上: NIP-52 イベントはあるが、ゲスト情報やチケットは出ていない ----
  const pool = new SimplePool();
  const evs = await pool.querySync([E2E_ENV.NOSTR_FALLBACK_RELAYS], { kinds: [31923], authors: [org.pubkey] }, { maxWait: 3000 });
  pool.destroy();
  expect(evs.some((e) => e.tags.some((t) => t[0] === "title" && t[1] === title))).toBe(true);
  const dump = JSON.stringify(evs);
  expect(dump).not.toContain(guestName);
  expect(dump).not.toContain("/ticket/");

  await orgCtx.close();
  await guestCtx.close();
});

test("Nostr 参加者: 申込 → 公開RSVPは明示的に選んだときだけ", async ({ browser }) => {
  const title = `RSVP テスト ${Date.now()}`;
  const orgCtx = await browser.newContext();
  await installNostrSigner(orgCtx);
  const orgPage = await orgCtx.newPage();
  await orgPage.goto("/create");
  await orgPage.getByLabel("イベント名").fill(title);
  await orgPage.getByRole("button", { name: /公開する/ }).click();
  await loginViaDialog(orgPage);
  await orgPage.waitForURL(/\?created=1/);
  await orgPage.locator("summary", { hasText: "リレーごとの公開状況" }).click();
  await expect(orgPage.getByText("Nostr に公開済み")).toBeVisible({ timeout: 20_000 });
  const slugPath = new URL((await orgPage.locator(".font-mono").first().textContent())!).pathname;

  const userCtx = await browser.newContext();
  const user = await installNostrSigner(userCtx);
  const page = await userCtx.newPage();
  await page.goto(slugPath);
  await page.getByRole("button", { name: "Nostr で申込む" }).click();
  await loginViaDialog(page);
  await expect(page.getByTestId("registration-result")).toHaveText("参加が確定しました");
  // 公開RSVP はまだ署名していない（NIP-98 のみ）
  expect(user.signed.map((s) => s.kind)).toEqual([27235]);

  await page.getByLabel(/Nostr に参加表明を公開する/).check();
  await expect(page.getByText("✓ Nostr に参加表明を公開しました")).toBeVisible();
  const rsvp = user.signed.find((s) => s.kind === 31925)!;
  expect(rsvp.tags.find((t) => t[0] === "status")?.[1]).toBe("accepted");
  expect(rsvp.tags.find((t) => t[0] === "a")?.[1]).toMatch(/^31923:[0-9a-f]{64}:/);

  // 再読み込み後もログイン済み・申込済みとして表示
  await page.reload();
  await expect(page.getByTestId("registration-result")).toHaveText("参加が確定しました");

  await orgCtx.close();
  await userCtx.close();
});
