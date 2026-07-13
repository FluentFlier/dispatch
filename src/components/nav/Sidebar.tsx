'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { PRODUCT_NAME } from '@/lib/brand';
import { primaryNav, moreNav, navIcons } from '@/lib/nav-config';
import WorkspaceSwitcher from '@/components/nav/WorkspaceSwitcher';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 focus-visible:ring-offset-2';

export default function Sidebar() {
  const pathname = usePathname();

  const handleSignOut = async () => {
    await getInsforgeClient().auth.signOut();
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    window.location.href = '/login';
  };

  return (
    <aside className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 z-40 h-screen w-[264px] border-r border-hair bg-paper2/90 backdrop-blur-xl">
      <div className="px-4 pb-4 pt-5">
        <Link
          href="/dashboard"
          className={`flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/70 ${FOCUS}`}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair bg-white text-[15px] font-semibold text-ink shadow-sm">
            /
          </span>
          <span>
            <span className="block text-[16px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {PRODUCT_NAME.toLowerCase()}.
            </span>
            <span className="block text-[11px] leading-tight text-ink3">
              Creator operating system
            </span>
          </span>
        </Link>
        <WorkspaceSwitcher />
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {primaryNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = navIcons[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${FOCUS} ${
                active
                  ? 'border border-hair2 bg-white text-ink shadow-sm'
                  : 'text-ink2 hover:bg-white/60 hover:text-ink'
              }`}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="mx-3 border-t border-hair px-3 pb-4 pt-4">
        <p className="mb-2 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink3">
          More
        </p>
        {moreNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = navIcons[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[38px] items-center gap-3 rounded-lg px-3 text-sm transition-colors ${FOCUS} ${
                active
                  ? 'bg-white/80 font-medium text-ink'
                  : 'text-ink3 hover:bg-white/50 hover:text-ink2'
              }`}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {item.name}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={handleSignOut}
          className={`mt-3 flex min-h-[38px] w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink3 transition-colors hover:bg-white/50 hover:text-ink2 ${FOCUS}`}
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
