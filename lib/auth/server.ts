// サーバーコンポーネント用（next/headers の cookies を使う）
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "../config";
import { findSession, type SessionUser } from "./session";

export async function getServerSession(): Promise<SessionUser | null> {
  const store = await cookies();
  return findSession(store.get(SESSION_COOKIE)?.value);
}
