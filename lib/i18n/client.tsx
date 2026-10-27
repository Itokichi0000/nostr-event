"use client";

import { createContext, useContext } from "react";
import { dicts, type Dict, type Lang } from "./dict";

const Ctx = createContext<{ t: Dict; lang: Lang; locale: string }>({ t: dicts.ja, lang: "ja", locale: "ja-JP" });

export function I18nProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <Ctx.Provider value={{ t: dicts[lang], lang, locale: lang === "ja" ? "ja-JP" : "en-US" }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
