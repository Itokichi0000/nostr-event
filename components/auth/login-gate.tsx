"use client";

import { LogIn } from "lucide-react";
import { useAuth } from "./auth-provider";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { useT } from "@/lib/i18n/client";

export function LoginGate({ message }: { message?: string }) {
  const { login } = useAuth();
  const { t } = useT();
  return (
    <EmptyState
      icon={<LogIn className="h-8 w-8" />}
      title={t.login.title}
      action={
        <Button size="lg" onClick={() => login()}>
          {t.nav.login}
        </Button>
      }
    >
      {message ?? t.login.lead}
    </EmptyState>
  );
}
