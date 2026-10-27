"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState } from "react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "info" | "danger";
type Toast = { id: number; tone: Tone; text: string; action?: { label: string; onClick: () => void } };

const Ctx = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "danger" ? 8000 : 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {items.map((t) => {
          const Icon = t.tone === "ok" ? CheckCircle2 : t.tone === "danger" ? XCircle : Info;
          return (
            <div
              key={t.id}
              role={t.tone === "danger" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border bg-surface px-4 py-3 text-sm font-semibold shadow-lg",
                t.tone === "ok" && "border-ok/30",
                t.tone === "danger" && "border-danger/40",
                t.tone === "info" && "border-info/30",
              )}
            >
              <Icon
                className={cn("h-5 w-5 shrink-0", t.tone === "ok" ? "text-ok" : t.tone === "danger" ? "text-danger" : "text-info")}
                aria-hidden
              />
              <span className="flex-1">{t.text}</span>
              {t.action && (
                <button className="rounded-lg px-2 py-1 font-bold text-primary hover:bg-surface-2" onClick={t.action.onClick}>
                  {t.action.label}
                </button>
              )}
              <button aria-label="閉じる" className="rounded-lg p-1 text-muted hover:bg-surface-2" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
