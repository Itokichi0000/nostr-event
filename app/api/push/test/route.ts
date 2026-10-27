import { ok, route } from "@/lib/api";
import { assertSameOrigin, requireSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { enforce } from "@/lib/security/rate-limit";
import { createNotification } from "@/lib/services/notifications";

// 設定画面の「テスト通知を送る」
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const s = await requireSession(req);
  await enforce(`pushtest:${s.accountId}`, 5, 600);
  const id = await getDb().transaction((tx) =>
    createNotification(tx, { recipientAccountId: s.accountId, type: "test", dedupeKey: `test:${s.accountId}:${Date.now()}` }),
  );
  return ok({ notificationId: id });
});
