import type { Metadata, Viewport } from "next";
import { nip19 } from "nostr-tools";
import { Header } from "@/components/layout/header";
import { Providers } from "@/components/layout/providers";
import { getServerSession } from "@/lib/auth/server";
import { config } from "@/lib/config";
import { getT } from "@/lib/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return {
    metadataBase: new URL(config.appUrl),
    title: { default: `${t.app.name} — ${t.app.tagline}`, template: `%s | ${t.app.name}` },
    description: t.explore.heroSub,
    applicationName: t.app.name,
    appleWebApp: { capable: true, title: t.app.name, statusBarStyle: "default" },
    icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
    referrer: "no-referrer",
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141412" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang } = await getT();
  const s = await getServerSession();
  const user = s ? { pubkey: s.pubkey, npub: nip19.npubEncode(s.pubkey), displayName: s.displayName, picture: s.picture } : null;
  return (
    <html lang={lang}>
      <body className="min-h-dvh antialiased">
        <Providers lang={lang} user={user}>
          <Header />
          <main id="main" className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:pb-16 sm:pt-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
