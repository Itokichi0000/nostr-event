import { LoginGate } from "@/components/auth/login-gate";
import { AccountCard, LanguageSetting, RelaySetting } from "@/components/layout/settings-forms";
import { PushSettings } from "@/components/notifications/push-settings";
import { PageTitle } from "@/components/ui/misc";
import { getServerSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { t } = await getT();
  const s = await getServerSession();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle>{t.settings.title}</PageTitle>
      {s ? (
        <>
          <PushSettings />
          <AccountCard />
          <RelaySetting />
        </>
      ) : (
        <LoginGate />
      )}
      <LanguageSetting />
    </div>
  );
}
