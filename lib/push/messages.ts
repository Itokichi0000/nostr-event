// ロック画面に表示される文面。氏名・メール・QR は含めない（詳細はアプリ内で認証後に表示）
export const PUSH_TEXT: Record<string, { title: string; body: string }> = {
  registration_confirmed: { title: "Gather", body: "新しい参加申込がありました" },
  registration_pending: { title: "Gather", body: "承認待ちの参加申込があります" },
  registration_waitlisted: { title: "Gather", body: "キャンセル待ちの申込がありました" },
  registration_cancelled: { title: "Gather", body: "参加申込がキャンセルされました" },
  waitlist_promoted: { title: "Gather", body: "キャンセル待ちから参加確定に繰り上がりました" },
  checkin_created: { title: "Gather", body: "参加者がチェックインしました" },
  external_rsvp: { title: "Gather", body: "Nostr 上で参加表明がありました" },
  event_cancelled: { title: "Gather", body: "申込んだイベントが中止になりました" },
  my_registration_approved: { title: "Gather", body: "参加申込が承認されました" },
  my_registration_rejected: { title: "Gather", body: "参加申込の結果が届きました" },
  my_registration_promoted: { title: "Gather", body: "キャンセル待ちから参加確定になりました" },
  test: { title: "Gather", body: "通知のテストです。この端末で受け取れます" },
};

export function pushPayload(n: { id: string; type: string; eventId: string | null; registrationId: string | null }, isOwner: boolean) {
  const text = PUSH_TEXT[n.type] ?? { title: "Gather", body: "新しいお知らせがあります" };
  const url = n.eventId ? (isOwner ? `/dashboard/events/${n.eventId}` : `/notifications`) : "/notifications";
  return { ...text, url, tag: `${n.type}:${n.eventId ?? "none"}`, notificationId: n.id };
}
