import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const tones = {
  info: { cls: "bg-info-soft text-info border-info/25", Icon: Info },
  ok: { cls: "bg-ok-soft text-ok border-ok/25", Icon: CheckCircle2 },
  warn: { cls: "bg-warn-soft text-warn border-warn/25", Icon: AlertTriangle },
  danger: { cls: "bg-danger-soft text-danger border-danger/25", Icon: XCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  action,
}: {
  tone?: keyof typeof tones;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  const { cls, Icon } = tones[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-3.5 text-sm", cls, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={cn(title && "mt-0.5", "text-fg/85")}>{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  );
}
