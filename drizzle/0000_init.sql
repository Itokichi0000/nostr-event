CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."checkin_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'publishing', 'published', 'cancelled', 'ended');--> statement-breakpoint
CREATE TYPE "public"."event_visibility" AS ENUM('public_nostr', 'unlisted_db');--> statement-breakpoint
CREATE TYPE "public"."nostr_publish_state" AS ENUM('pending', 'partial', 'success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."registration_source" AS ENUM('app_nostr', 'app_guest');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('pending', 'confirmed', 'waitlisted', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."relay_attempt_status" AS ENUM('pending', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."rsvp_intent" AS ENUM('accepted', 'declined', 'tentative');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nostr_pubkey" char(64) NOT NULL,
	"display_name" text,
	"picture" text,
	"nip65_relays" jsonb,
	"custom_relays" jsonb,
	"profile_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_nostr_pubkey_unique" UNIQUE("nostr_pubkey")
);
--> statement-breakpoint
CREATE TABLE "auth_replays" (
	"event_id" char(64) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"operator_account_id" uuid NOT NULL,
	"method" "checkin_method" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checkins_registration_id_unique" UNIQUE("registration_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"owner_pubkey" char(64) NOT NULL,
	"visibility" "event_visibility" NOT NULL,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"nostr_kind" integer,
	"nostr_d" text,
	"nostr_coordinate" text,
	"latest_nostr_event_id" char(64),
	"latest_nostr_created_at" integer,
	"nostr_publish_state" "nostr_publish_state",
	"title" text NOT NULL,
	"summary" text,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"location" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"timezone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"capacity" integer,
	"approval_mode" "approval_mode" DEFAULT 'auto' NOT NULL,
	"allow_guest" boolean DEFAULT true NOT NULL,
	"checkin_open_at" timestamp with time zone,
	"checkin_close_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_slug_unique" UNIQUE("slug"),
	CONSTRAINT "events_capacity_positive" CHECK ("events"."capacity" IS NULL OR "events"."capacity" > 0),
	CONSTRAINT "events_time_order" CHECK ("events"."end_at" >= "events"."start_at"),
	CONSTRAINT "events_nostr_fields" CHECK ("events"."visibility" <> 'public_nostr' OR ("events"."nostr_kind" IS NOT NULL AND "events"."nostr_d" IS NOT NULL AND "events"."nostr_coordinate" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "external_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attendee_pubkey" char(64) NOT NULL,
	"rsvp_d" text NOT NULL,
	"latest_event_id" char(64) NOT NULL,
	"intent" "rsvp_intent" NOT NULL,
	"referenced_event_id" char(64),
	"latest_created_at" integer NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nostr_events" (
	"id" char(64) PRIMARY KEY NOT NULL,
	"kind" integer NOT NULL,
	"pubkey" char(64) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"coordinate" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_account_id" uuid NOT NULL,
	"event_id" uuid,
	"registration_id" uuid,
	"type" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 10 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "push_deliveries" (
	"notification_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_deliveries_notification_id_subscription_id_pk" PRIMARY KEY("notification_id","subscription_id")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"endpoint_hash" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_hash_unique" UNIQUE("endpoint_hash")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"account_id" uuid,
	"nostr_pubkey" char(64),
	"guest_name" text,
	"guest_email" text,
	"source" "registration_source" NOT NULL,
	"status" "registration_status" NOT NULL,
	"public_rsvp_d" text,
	"public_rsvp_event_id" char(64),
	"public_rsvp_status" "rsvp_intent",
	"idempotency_key" uuid,
	"confirmed_at" timestamp with time zone,
	"waitlisted_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_identity" CHECK (("registrations"."source" = 'app_nostr' AND "registrations"."nostr_pubkey" IS NOT NULL AND "registrations"."account_id" IS NOT NULL AND "registrations"."guest_name" IS NULL)
        OR ("registrations"."source" = 'app_guest' AND "registrations"."nostr_pubkey" IS NULL AND "registrations"."guest_name" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "relay_publish_attempts" (
	"nostr_event_id" char(64) NOT NULL,
	"relay_url" text NOT NULL,
	"status" "relay_attempt_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_retry_at" timestamp with time zone,
	"acked_at" timestamp with time zone,
	CONSTRAINT "relay_publish_attempts_nostr_event_id_relay_url_pk" PRIMARY KEY("nostr_event_id","relay_url")
);
--> statement-breakpoint
CREATE TABLE "revoked_tickets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"registration_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"signer_type" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_registration_id_unique" UNIQUE("registration_id"),
	CONSTRAINT "tickets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "worker_cursors" (
	"name" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_operator_account_id_accounts_id_fk" FOREIGN KEY ("operator_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_rsvps" ADD CONSTRAINT "external_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_account_id_accounts_id_fk" FOREIGN KEY ("recipient_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_subscription_id_push_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."push_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relay_publish_attempts" ADD CONSTRAINT "relay_publish_attempts_nostr_event_id_nostr_events_id_fk" FOREIGN KEY ("nostr_event_id") REFERENCES "public"."nostr_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revoked_tickets" ADD CONSTRAINT "revoked_tickets_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_nostr_coordinate_uq" ON "events" USING btree ("nostr_kind","owner_pubkey","nostr_d");--> statement-breakpoint
CREATE INDEX "events_owner_idx" ON "events" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "events_start_idx" ON "events" USING btree ("start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "external_rsvps_event_attendee_uq" ON "external_rsvps" USING btree ("event_id","attendee_pubkey");--> statement-breakpoint
CREATE INDEX "nostr_events_coordinate_idx" ON "nostr_events" USING btree ("coordinate");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_account_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_jobs_ready_idx" ON "outbox_jobs" USING btree ("available_at") WHERE "outbox_jobs"."processed_at" IS NULL AND "outbox_jobs"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "push_subscriptions_account_idx" ON "push_subscriptions" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_pubkey_uq" ON "registrations" USING btree ("event_id","nostr_pubkey") WHERE "registrations"."nostr_pubkey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_idem_uq" ON "registrations" USING btree ("event_id","idempotency_key") WHERE "registrations"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "registrations_event_status_idx" ON "registrations" USING btree ("event_id","status","created_at");--> statement-breakpoint
CREATE INDEX "registrations_account_idx" ON "registrations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");