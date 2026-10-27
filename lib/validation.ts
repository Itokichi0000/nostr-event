// フロント・API 共通の入力検証（Zod）
import { z } from "zod";
import { allDayRange } from "./nostr/nip52";
import { isValidDateString, isValidTimeZone, zonedToUtc } from "./time";

const dateStr = z.string().refine(isValidDateString, "日付の形式が正しくありません");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時刻の形式が正しくありません");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const safeUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, "URL は http(s):// で始まる必要があります");

export const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, "イベント名を入力してください").max(120),
    summary: optionalText(280),
    description: z.string().max(20000).default(""),
    imageUrl: safeUrl.nullish().transform((v) => v ?? null),
    location: optionalText(300),
    hashtags: z
      .array(z.string().trim().toLowerCase().regex(/^[\p{L}\p{N}_-]{1,40}$/u, "タグに使えない文字が含まれています"))
      .max(10)
      .default([]),
    isAllDay: z.boolean().default(false),
    startDate: dateStr,
    startTime: timeStr.default("19:00"),
    endDate: dateStr,
    endTime: timeStr.default("21:00"),
    timezone: z.string().refine(isValidTimeZone, "タイムゾーンが正しくありません").default("Asia/Tokyo"),
    capacity: z.number().int().min(1).max(100000).nullish().transform((v) => v ?? null),
    approvalMode: z.enum(["auto", "manual"]).default("auto"),
    allowGuest: z.boolean().default(true),
    visibility: z.enum(["public_nostr", "unlisted_db"]).default("public_nostr"),
  })
  .superRefine((v, ctx) => {
    let range;
    try {
      range = toRange(v);
    } catch {
      return; // 個別項目のエラーとして既に報告済み
    }
    const { startAt, endAt } = range;
    if (endAt <= startAt) {
      ctx.addIssue({ code: "custom", path: ["endTime"], message: "終了は開始より後にしてください" });
    }
    if (endAt.getTime() - startAt.getTime() > 366 * 86400 * 1000) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "期間は1年以内にしてください" });
    }
  });

export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventForm = z.output<typeof eventFormSchema>;

export function toRange(v: Pick<EventForm, "isAllDay" | "startDate" | "startTime" | "endDate" | "endTime" | "timezone">) {
  if (v.isAllDay) return allDayRange(v.startDate, v.endDate < v.startDate ? v.startDate : v.endDate, v.timezone);
  return { startAt: zonedToUtc(v.startDate, v.startTime, v.timezone), endAt: zonedToUtc(v.endDate, v.endTime, v.timezone) };
}

export const registrationSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("nostr"),
    idempotencyKey: z.uuid(),
  }),
  z.object({
    mode: z.literal("guest"),
    displayName: z.string().trim().min(1, "お名前を入力してください").max(60),
    email: z
      .union([z.email("メールアドレスの形式が正しくありません").max(254), z.literal(""), z.null()])
      .optional()
      .transform((v) => (v ? v : null)),
    idempotencyKey: z.uuid(),
  }),
]);

export type RegistrationInput = z.infer<typeof registrationSchema>;
