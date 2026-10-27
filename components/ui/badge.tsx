import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap border", {
  variants: {
    tone: {
      neutral: "bg-surface-2 text-muted border-border",
      ok: "bg-ok-soft text-ok border-ok/25",
      warn: "bg-warn-soft text-warn border-warn/25",
      danger: "bg-danger-soft text-danger border-danger/25",
      info: "bg-info-soft text-info border-info/25",
      primary: "bg-primary-soft text-primary border-primary/25",
      accent: "bg-accent-soft text-accent border-accent/25",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />;
}
