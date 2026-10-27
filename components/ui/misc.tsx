import { Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn("flex items-center justify-center gap-2 py-10 text-muted", className)}>
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span>{label ?? "読み込み中…"}</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-surface px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <p className="text-base font-bold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "ok" | "warn" | "info" | "primary" }) {
  const toneCls = { ok: "text-ok", warn: "text-warn", info: "text-info", primary: "text-primary" }[tone ?? "primary"];
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-bold tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 text-3xl font-extrabold tabular-nums", toneCls)}>{value}</p>
      {sub && <p className="text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function PageTitle({ children, sub, actions }: { children: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">{children}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
