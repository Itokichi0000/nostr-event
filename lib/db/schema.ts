import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const eventVisibility = pgEnum("event_visibility", ["public_nostr", "unlisted_db"]);
export const eventStatus = pgEnum("event_status", ["draft", "publishing", "published", "cancelled", "ended"]);
export const publishState = pgEnum("nostr_publish_state", ["pending", "partial", "success", "failed"]);
export const approvalMode = pgEnum("approval_mode", ["auto", "manual"]);
export const registrationSource = pgEnum("registration_source", ["app_nostr", "app_guest"]);
export const registrationStatus = pgEnum("registration_status", [
  "pending",
  "confirmed",
  "waitlisted",
  "rejected",
  "cancelled",
]);
export const checkinMethod = pgEnum("checkin_method", ["qr", "manual"]);
export const rsvpIntent = pgEnum("rsvp_intent", ["accepted", "declined", "tentative"]);
export const relayAttemptStatus = pgEnum("relay_attempt_status", ["pending", "ok", "failed"]);

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  nostrPubkey: char("nostr_pubkey", { length: 64 }).notNull().unique(),
  displayName: text("display_name"),
  picture: text("picture"),
  // NIP-65 から取得した書込/受信リレー（キャッシュ）
  nip65Relays: jsonb("nip65_relays").$type<{ url: string; read: boolean; write: boolean }[]>(),
  // 利用者が詳細設定で指定した書込リレー（NIP-65より優先）
  customRelays: jsonb("custom_relays").$type<string[]>(),
  profileFetchedAt: ts("profile_fetched_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    signerType: text("signer_type"),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_account_idx").on(t.accountId)],
);

// NIP-98 認証イベントのリプレイ防止
export const authReplays = pgTable("auth_replays", {
  eventId: char("event_id", { length: 64 }).primaryKey(),
  seenAt: createdAt(),
});

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    ownerAccountId: uuid("owner_account_id")
      .notNull()
      .references(() => accounts.id),
    ownerPubkey: char("owner_pubkey", { length: 64 }).notNull(),
    visibility: eventVisibility("visibility").notNull(),
    status: eventStatus("status").notNull().default("draft"),
    nostrKind: integer("nostr_kind"),
    nostrD: text("nostr_d"),
    nostrCoordinate: text("nostr_coordinate"),
    latestNostrEventId: char("latest_nostr_event_id", { length: 64 }),
    latestNostrCreatedAt: integer("latest_nostr_created_at"),
    nostrPublishState: publishState("nostr_publish_state"),
    title: text("title").notNull(),
    summary: text("summary"),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    location: text("location"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    timezone: text("timezone").notNull().default("Asia/Tokyo"),
    isAllDay: boolean("is_all_day").notNull().default(false),
    capacity: integer("capacity"),
    approvalMode: approvalMode("approval_mode").notNull().default("auto"),
    allowGuest: boolean("allow_guest").notNull().default(true),
    checkinOpenAt: ts("checkin_open_at"),
    checkinCloseAt: ts("checkin_close_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_nostr_coordinate_uq").on(t.nostrKind, t.ownerPubkey, t.nostrD),
    index("events_owner_idx").on(t.ownerAccountId),
    index("events_start_idx").on(t.startAt),
    check("events_capacity_positive", sql`${t.capacity} IS NULL OR ${t.capacity} > 0`),
    check("events_time_order", sql`${t.endAt} >= ${t.startAt}`),
    check(
      "events_nostr_fields",
      sql`${t.visibility} <> 'public_nostr' OR (${t.nostrKind} IS NOT NULL AND ${t.nostrD} IS NOT NULL AND ${t.nostrCoordinate} IS NOT NULL)`,
    ),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id),
    nostrPubkey: char("nostr_pubkey", { length: 64 }),
    guestName: text("guest_name"),
    guestEmail: text("guest_email"),
    source: registrationSource("source").notNull(),
    status: registrationStatus("status").notNull(),
    // 公開RSVP（31925）の d。初回に決めて取消でも再利用する
    publicRsvpD: text("public_rsvp_d"),
    publicRsvpEventId: char("public_rsvp_event_id", { length: 64 }),
    publicRsvpStatus: rsvpIntent("public_rsvp_status"),
    idempotencyKey: uuid("idempotency_key"),
    confirmedAt: ts("confirmed_at"),
    // キャンセル待ちに入った時刻（繰り上げは この順）
    waitlistedAt: ts("waitlisted_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("registrations_event_pubkey_uq")
      .on(t.eventId, t.nostrPubkey)
      .where(sql`${t.nostrPubkey} IS NOT NULL`),
    uniqueIndex("registrations_event_idem_uq")
      .on(t.eventId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("registrations_event_status_idx").on(t.eventId, t.status, t.createdAt),
    index("registrations_account_idx").on(t.accountId),
    check(
      "registrations_identity",
      sql`(${t.source} = 'app_nostr' AND ${t.nostrPubkey} IS NOT NULL AND ${t.accountId} IS NOT NULL AND ${t.guestName} IS NULL)
        OR (${t.source} = 'app_guest' AND ${t.nostrPubkey} IS NULL AND ${t.guestName} IS NOT NULL)`,
    ),
  ],
);

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  registrationId: uuid("registration_id")
    .notNull()
    .unique()
    .references(() => registrations.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  revokedAt: ts("revoked_at"),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
});

// 失効済みトークン（「古いQRです」を区別して表示するため）
export const revokedTickets = pgTable("revoked_tickets", {
  tokenHash: text("token_hash").primaryKey(),
  registrationId: uuid("registration_id")
    .notNull()
    .references(() => registrations.id, { onDelete: "cascade" }),
  revokedAt: createdAt(),
});

export const checkins = pgTable("checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id")
    .notNull()
    .references(() => events.id, { onDelete: "cascade" }),
  registrationId: uuid("registration_id")
    .notNull()
    .unique()
    .references(() => registrations.id, { onDelete: "cascade" }),
  operatorAccountId: uuid("operator_account_id")
    .notNull()
    .references(() => accounts.id),
  method: checkinMethod("method").notNull(),
  checkedInAt: createdAt(),
});

export const nostrEvents = pgTable(
  "nostr_events",
  {
    id: char("id", { length: 64 }).primaryKey(),
    kind: integer("kind").notNull(),
    pubkey: char("pubkey", { length: 64 }).notNull(),
    createdAt: ts("created_at").notNull(),
    raw: jsonb("raw").notNull().$type<NostrEventRaw>(),
    coordinate: text("coordinate"),
    ingestedAt: ts("ingested_at").notNull().defaultNow(),
  },
  (t) => [index("nostr_events_coordinate_idx").on(t.coordinate)],
);

export type NostrEventRaw = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export const externalRsvps = pgTable(
  "external_rsvps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    attendeePubkey: char("attendee_pubkey", { length: 64 }).notNull(),
    rsvpD: text("rsvp_d").notNull(),
    latestEventId: char("latest_event_id", { length: 64 }).notNull(),
    intent: rsvpIntent("intent").notNull(),
    // RSVP が参照する特定版（e タグ）。古い版への参加表明を表示するため
    referencedEventId: char("referenced_event_id", { length: 64 }),
    latestCreatedAt: integer("latest_created_at").notNull(),
    seenAt: ts("seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("external_rsvps_event_attendee_uq").on(t.eventId, t.attendeePubkey)],
);

export const relayPublishAttempts = pgTable(
  "relay_publish_attempts",
  {
    nostrEventId: char("nostr_event_id", { length: 64 })
      .notNull()
      .references(() => nostrEvents.id, { onDelete: "cascade" }),
    relayUrl: text("relay_url").notNull(),
    status: relayAttemptStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextRetryAt: ts("next_retry_at"),
    ackedAt: ts("acked_at"),
  },
  (t) => [primaryKey({ columns: [t.nostrEventId, t.relayUrl] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientAccountId: uuid("recipient_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    registrationId: uuid("registration_id").references(() => registrations.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>().default({}),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientAccountId, t.createdAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    endpointHash: text("endpoint_hash").notNull().unique(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    lastSuccessAt: ts("last_success_at"),
    lastFailureAt: ts("last_failure_at"),
  },
  (t) => [index("push_subscriptions_account_idx").on(t.accountId)],
);

// 通知×端末の配送記録。ジョブ再試行時に配送済み端末へ二重送信しない
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    deliveredAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.subscriptionId] })],
);

export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(10),
    availableAt: ts("available_at").notNull().defaultNow(),
    lockedAt: ts("locked_at"),
    processedAt: ts("processed_at"),
    failedAt: ts("failed_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("outbox_jobs_ready_idx")
      .on(t.availableAt)
      .where(sql`${t.processedAt} IS NULL AND ${t.failedAt} IS NULL`),
  ],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

// ワーカーのバックフィル位置（リレー購読の since）
export const workerCursors = pgTable("worker_cursors", {
  name: text("name").primaryKey(),
  value: integer("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type Account = typeof accounts.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type OutboxJob = typeof outboxJobs.$inferSelect;
