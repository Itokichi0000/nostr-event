"use client";

import { Bell, CalendarPlus, CircleUser, Compass, LayoutDashboard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

function NavLink({ href, children, active }: { href: string; children: React.ReactNode; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-xl px-3 py-2 text-[15px] font-semibold text-muted hover:bg-surface-2 hover:text-fg",
        active && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
      )}
    >
      {children}
    </Link>
  );
}

function BellLink({ className }: { className?: string }) {
  const { unread } = useNotifications();
  const { t } = useT();
  return (
    <Link
      href="/notifications"
      className={cn("relative inline-flex h-11 w-11 items-center justify-center rounded-xl text-fg hover:bg-surface-2", className)}
      aria-label={unread ? `${t.nav.notifications}（未読 ${unread}件）` : t.nav.notifications}
    >
      <Bell className="h-5 w-5" aria-hidden />
      {unread > 0 && (
        <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-5 text-white" data-testid="unread-count">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}

export function Header() {
  const { user, login, logout } = useAuth();
  const { t } = useT();
  const path = usePathname();
  const [menu, setMenu] = useState(false);
  const is = (p: string) => (p === "/" ? path === "/" : path.startsWith(p));

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2">
        {t.nav.skip}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4">
          <Link href="/" className="mr-2 flex items-center gap-2 text-xl font-black tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-fg" aria-hidden>
              G
            </span>
            {t.app.name}
          </Link>
          <nav aria-label="メイン" className="hidden items-center gap-1 sm:flex">
            <NavLink href="/" active={is("/")}>
              {t.nav.explore}
            </NavLink>
            <NavLink href="/create" active={is("/create")}>
              {t.nav.create}
            </NavLink>
            <NavLink href="/dashboard" active={is("/dashboard")}>
              {t.nav.mine}
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {user ? (
              <>
                <BellLink className="hidden sm:inline-flex" />
                <div className="relative">
                  <button
                    className="flex h-11 items-center gap-2 rounded-xl px-2 hover:bg-surface-2"
                    aria-haspopup="menu"
                    aria-expanded={menu}
                    onClick={() => setMenu((v) => !v)}
                  >
                    {user.picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={user.picture} alt="" className="h-8 w-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <CircleUser className="h-7 w-7 text-muted" aria-hidden />
                    )}
                    <span className="hidden max-w-32 truncate text-sm font-semibold md:inline">
                      {user.displayName ?? `${user.npub.slice(0, 10)}…`}
                    </span>
                  </button>
                  {menu && (
                    <div role="menu" className="absolute right-0 mt-1 w-52 rounded-2xl border border-border bg-surface p-1.5 shadow-xl" onClick={() => setMenu(false)}>
                      <Link role="menuitem" href="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                        <Settings className="h-4 w-4" aria-hidden /> {t.nav.settings}
                      </Link>
                      <button role="menuitem" onClick={() => logout()} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left hover:bg-surface-2">
                        <LogOut className="h-4 w-4" aria-hidden /> {t.nav.logout}
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <Button size="sm" onClick={() => login()}>
                {t.nav.login}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* スマホ: 親指で届く下部ナビ */}
      <nav
        aria-label="モバイルナビ"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
      >
        {[
          { href: "/", label: t.nav.explore, Icon: Compass },
          { href: "/create", label: t.nav.create, Icon: CalendarPlus },
          { href: "/dashboard", label: t.nav.mine, Icon: LayoutDashboard },
          { href: "/notifications", label: t.nav.notifications, Icon: Bell },
        ].map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={is(href) ? "page" : undefined}
            className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-muted", is(href) && "text-primary")}
          >
            <Icon className="h-6 w-6" aria-hidden />
            {label}
            {href === "/notifications" && user && <MobileBadge />}
          </Link>
        ))}
      </nav>
    </>
  );
}

function MobileBadge() {
  const { unread } = useNotifications();
  if (!unread) return null;
  return <span className="absolute right-[calc(50%-20px)] top-1 h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />;
}
