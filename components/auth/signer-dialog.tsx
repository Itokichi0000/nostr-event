"use client";

import { KeyRound, Puzzle, Smartphone } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/client/api";
import {
  connectBunker,
  loginWithSigner,
  nip07Signer,
  SignerRejected,
  startNostrConnect,
  waitForNip07,
  type AppSigner,
} from "@/lib/client/signer";
import { useT } from "@/lib/i18n/client";

/**
 * 署名器の接続。mode=login なら NIP-98 でセッションまで作る。
 * mode=connect は既にログイン済みで、署名のために署名器だけ繋ぎ直す場合。
 */
export function SignerDialog({
  open,
  mode,
  title,
  expectedPubkey,
  onDone,
}: {
  open: boolean;
  mode: "login" | "connect";
  title: string;
  expectedPubkey: string | null;
  onDone: (s: AppSigner | null) => void;
}) {
  const { t } = useT();
  const [hasExt, setHasExt] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"ext" | "bunker" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectUri, setConnectUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [bunker, setBunker] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    waitForNip07(1200).then((n) => setHasExt(!!n));
    return () => abortRef.current?.abort();
  }, [open]);

  async function finish(signer: AppSigner) {
    const pk = await signer.getPublicKey();
    if (expectedPubkey && pk !== expectedPubkey) {
      throw new Error("ログイン中とは別のアカウントです。同じアカウントの署名アプリを接続してください");
    }
    if (mode === "login") await loginWithSigner(signer);
    abortRef.current?.abort();
    onDone(signer);
  }

  function explain(e: unknown): string {
    if (e instanceof SignerRejected) return t.login.rejected;
    if (e instanceof ApiClientError) return e.message;
    return e instanceof Error && e.message ? e.message : t.login.failed;
  }

  async function connectExtension() {
    setBusy("ext");
    setError(null);
    try {
      const ext = await waitForNip07(300);
      if (!ext) throw new Error(t.login.noExtension);
      await finish(nip07Signer(ext));
    } catch (e) {
      setError(explain(e));
    } finally {
      setBusy(null);
    }
  }

  async function startMobile() {
    setError(null);
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const { uri, signer } = await startNostrConnect(ac.signal);
      setConnectUri(uri);
      setQr(await QRCode.toDataURL(uri, { margin: 1, width: 240 }));
      const s = await signer;
      await finish(s);
    } catch (e) {
      if (!ac.signal.aborted) setError(explain(e));
    }
  }

  async function submitBunker(e: React.FormEvent) {
    e.preventDefault();
    setBusy("bunker");
    setError(null);
    try {
      await finish(await connectBunker(bunker));
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(null);
    }
  }

  const close = () => {
    abortRef.current?.abort();
    setConnectUri(null);
    setQr(null);
    onDone(null);
  };

  return (
    <Dialog open={open} onClose={close} title={title}>
      <p className="mb-4 text-sm text-muted">{t.login.lead}</p>
      {error && <Alert tone="danger" className="mb-4" title={error} />}

      <div className="space-y-3">
        <button
          type="button"
          onClick={connectExtension}
          disabled={busy !== null}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface p-4 text-left hover:bg-surface-2 disabled:opacity-60"
        >
          <Puzzle className="h-6 w-6 shrink-0 text-primary" aria-hidden />
          <span className="flex-1">
            <span className="block font-bold">{t.login.extension}</span>
            <span className="block text-sm text-muted">{hasExt === false ? t.login.noExtension : t.login.extensionHint}</span>
          </span>
          {busy === "ext" && <span className="text-sm text-muted">…</span>}
        </button>

        <div className="rounded-2xl border border-border p-4">
          <div className="flex items-center gap-3">
            <Smartphone className="h-6 w-6 shrink-0 text-primary" aria-hidden />
            <div className="flex-1">
              <p className="font-bold">{t.login.mobile}</p>
              <p className="text-sm text-muted">{t.login.mobileHint}</p>
            </div>
          </div>
          {!connectUri ? (
            <Button variant="outline" className="mt-3 w-full" onClick={startMobile}>
              {t.login.mobile}
            </Button>
          ) : (
            <div className="mt-3 flex flex-col items-center gap-3">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="nostrconnect QR" width={200} height={200} className="rounded-xl bg-white p-2" />
              )}
              <a href={connectUri} className="w-full">
                <Button className="w-full">{t.login.openSignerApp}</Button>
              </a>
              <p className="text-sm text-muted" role="status">
                {t.login.waiting}
              </p>
            </div>
          )}
        </div>

        <details className="rounded-2xl border border-border p-4">
          <summary className="flex cursor-pointer items-center gap-3 font-bold">
            <KeyRound className="h-5 w-5 text-primary" aria-hidden />
            {t.login.bunker}
          </summary>
          <form onSubmit={submitBunker} className="mt-3 flex gap-2">
            <Input
              value={bunker}
              onChange={(e) => setBunker(e.target.value)}
              placeholder={t.login.bunkerPlaceholder}
              aria-label={t.login.bunker}
              autoComplete="off"
            />
            <Button type="submit" loading={busy === "bunker"} disabled={!bunker.trim()}>
              {t.login.connect}
            </Button>
          </form>
        </details>
      </div>
      <p className="mt-4 text-center text-xs text-muted">{t.login.noNsec}</p>
    </Dialog>
  );
}
