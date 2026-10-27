"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { PageTitle } from "@/components/ui/misc";
import { useT } from "@/lib/i18n/client";

function LoginInner() {
  const { user, login } = useAuth();
  const { t } = useT();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  useEffect(() => {
    if (user) router.replace(dest);
  }, [user, dest, router]);
  return (
    <div className="mx-auto max-w-md text-center">
      <PageTitle sub={t.login.lead}>{t.login.title}</PageTitle>
      <Button size="lg" className="w-full" onClick={() => login()}>
        {t.nav.login}
      </Button>
      <p className="mt-4 text-sm text-muted">{t.login.noNsec}</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
