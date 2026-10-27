"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import {
  clearStoredSigner,
  hasStoredNip46,
  restoreNip46,
  nip07Signer,
  SignerRejected,
  waitForNip07,
  type AppSigner,
} from "@/lib/client/signer";
import type { EventTemplate, SignedEvent } from "@/lib/nostr/nip52";
import { useT } from "@/lib/i18n/client";
import { SignerDialog } from "./signer-dialog";

export type ClientUser = { pubkey: string; npub: string; displayName: string | null; picture: string | null };

type AuthCtx = {
  user: ClientUser | null;
  /** ログイン（署名器の選択ダイアログを開く）。成功時に resolve */
  login: () => Promise<ClientUser | null>;
  logout: () => Promise<void>;
  /** ログイン中のアカウントで署名。署名器が未接続なら接続ダイアログを出す */
  sign: (t: EventTemplate) => Promise<SignedEvent>;
};

const Ctx = createContext<AuthCtx | null>(null);

export class WrongAccount extends Error {}

export function AuthProvider({ initialUser, children }: { initialUser: ClientUser | null; children: React.ReactNode }) {
  const router = useRouter();
  const { t } = useT();
  const [user, setUser] = useState(initialUser);
  const signerRef = useRef<AppSigner | null>(null);
  const [dialog, setDialog] = useState<{ mode: "login" | "connect"; resolve: (s: AppSigner | null) => void } | null>(null);

  const askSigner = useCallback(
    (mode: "login" | "connect") => new Promise<AppSigner | null>((resolve) => setDialog({ mode, resolve })),
    [],
  );

  const login = useCallback(async () => {
    const signer = await askSigner("login");
    if (!signer) return null;
    signerRef.current = signer;
    const me = await api<ClientUser>("/api/auth/me");
    setUser(me);
    router.refresh();
    return me;
  }, [askSigner, router]);

  const getSigner = useCallback(async (): Promise<AppSigner> => {
    if (signerRef.current) return signerRef.current;
    // 再読み込み後: 拡張があれば NIP-07、同じタブで接続済みなら NIP-46 を復元
    if (hasStoredNip46()) {
      const s = await restoreNip46();
      if (s) return (signerRef.current = s);
    }
    const ext = await waitForNip07(600);
    if (ext) return (signerRef.current = nip07Signer(ext));
    const s = await askSigner("connect");
    if (!s) throw new SignerRejected("cancelled");
    return (signerRef.current = s);
  }, [askSigner]);

  const sign = useCallback(
    async (tpl: EventTemplate) => {
      const signer = await getSigner();
      const signed = await signer.signEvent(tpl);
      if (user && signed.pubkey !== user.pubkey) {
        // 拡張のアカウントが切り替わっている等
        signerRef.current = null;
        throw new WrongAccount("ログイン中とは別のアカウントで署名されました。署名アプリのアカウントを確認してください");
      }
      return signed;
    },
    [getSigner, user],
  );

  const logout = useCallback(async () => {
    let pushEndpoint: string | undefined;
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        pushEndpoint = sub.endpoint;
        await sub.unsubscribe();
      }
    } catch {}
    await api("/api/auth/logout", { method: "POST", body: { pushEndpoint } }).catch(() => {});
    await signerRef.current?.close?.().catch(() => {});
    signerRef.current = null;
    clearStoredSigner();
    setUser(null);
    router.push("/");
    router.refresh();
  }, [router]);

  const value = useMemo(() => ({ user, login, logout, sign }), [user, login, logout, sign]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <SignerDialog
        open={!!dialog}
        mode={dialog?.mode ?? "login"}
        title={dialog?.mode === "connect" ? t.login.signerNeeded : t.login.title}
        expectedPubkey={dialog?.mode === "connect" ? (user?.pubkey ?? null) : null}
        onDone={(s) => {
          dialog?.resolve(s);
          setDialog(null);
        }}
      />
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("AuthProvider がありません");
  return c;
}
