"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Hint, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client/api";
import { useT } from "@/lib/i18n/client";

export function LanguageSetting() {
  const { t, lang } = useT();
  const router = useRouter();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.language}</CardTitle>
      </CardHeader>
      <CardContent>
        <Select
          aria-label={t.settings.language}
          className="max-w-60"
          value={lang}
          onChange={(e) => {
            document.cookie = `gather_lang=${e.target.value}; Path=/; Max-Age=31536000; SameSite=Lax`;
            router.refresh();
          }}
        >
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </Select>
      </CardContent>
    </Card>
  );
}

export function RelaySetting() {
  const { t } = useT();
  const toast = useToast();
  const [text, setText] = useState("");
  const [nip65, setNip65] = useState<{ url: string; write: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ custom: string[]; nip65: { url: string; write: boolean }[] }>("/api/me/relays")
      .then((r) => {
        setText(r.custom.join("\n"));
        setNip65(r.nip65);
      })
      .catch(() => {});
  }, []);
  async function save() {
    setBusy(true);
    try {
      const relays = text
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      await api("/api/me/relays", { method: "PUT", body: { relays } });
      toast({ tone: "ok", text: t.settings.relaysSaved });
    } catch (e) {
      toast({ tone: "danger", text: e instanceof Error ? e.message : t.common.unknownError });
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded-2xl border border-border bg-surface p-5">
      <summary className="cursor-pointer text-lg font-bold">{t.settings.relays}</summary>
      <div className="mt-3 space-y-3">
        <Hint>{t.settings.relaysHint}</Hint>
        {nip65.length > 0 && (
          <p className="text-xs text-muted">
            NIP-65: {nip65.filter((r) => r.write).map((r) => r.url).join(", ")}
          </p>
        )}
        <Textarea aria-label={t.settings.relays} value={text} onChange={(e) => setText(e.target.value)} placeholder="wss://relay.example.com" rows={4} />
        <Button onClick={save} loading={busy}>
          {t.common.save}
        </Button>
      </div>
    </details>
  );
}

export function AccountCard() {
  const { user, logout } = useAuth();
  const { t } = useT();
  if (!user) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.settings.account}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {user.displayName && <p className="font-bold">{user.displayName}</p>}
        <p className="break-all font-mono text-xs text-muted">{user.npub}</p>
        <Button variant="outline" onClick={() => logout()}>
          {t.nav.logout}
        </Button>
      </CardContent>
    </Card>
  );
}
