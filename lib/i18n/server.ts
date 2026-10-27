import { cookies } from "next/headers";
import { dicts, type Lang } from "./dict";

export const LANG_COOKIE = "gather_lang";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return v === "en" ? "en" : "ja";
}

export async function getT() {
  const lang = await getLang();
  return { t: dicts[lang], lang, locale: lang === "ja" ? "ja-JP" : "en-US" };
}
