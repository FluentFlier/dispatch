'use client';

import { type ComponentType, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  FileText,
  Home,
  Lightbulb,
  LogOut,
  MessageSquare,
  PenLine,
  Settings,
  SlidersHorizontal,
} from 'lucide-react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { primaryNav, moreNav } from '@/lib/nav-config';

const navIcons: Record<string, ComponentType<{ className?: string }>> = {
  '/dashboard': Home,
  '/generate': PenLine,
  '/library': FileText,
  '/calendar': CalendarDays,
  '/inbox': MessageSquare,
  '/ideas': Lightbulb,
  '/voice-lab': SlidersHorizontal,
  '/analytics': BarChart3,
  '/settings': Settings,
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [userLabel, setUserLabel] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/session', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!res.ok) return;
        const session = await res.json();
        if (!session.authenticated) return;
        setUserLabel(session.profile?.displayName || session.user?.email || '');
      } catch {
        /* optional */
      }
    })();
  }, []);

  const handleSignOut = async () => {
    await getInsforgeClient().auth.signOut();
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    router.push('/login');
  };

  const firstName = userLabel.includes('@') ? userLabel.split('@')[0] : userLabel.split(' ')[0];

  return (
    <aside className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 w-[264px] h-screen z-40 bg-[#101312] text-white border-r border-black/10">
      <div className="px-4 pt-5 pb-4">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5 transition-colors">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[#101312] text-sm font-semibold">
            D
          </span>
          <span>
            <span className="block text-sm font-semibold leading-tight">Dispatch</span>
            <span className="block text-[11px] text-white/45 leading-tight">Creator operating system</span>
          </span>
        </Link>
        {userLabel && (
          <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-white/40">Workspace</p>
            <p className="mt-0.5 truncate text-sm text-white/85">{firstName}</p>
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {primaryNav.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = navIcons[item.href];
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 min-h-[40px] px-3 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-[#101312]'
                  : 'text-white/62 hover:bg-white/[0.06] hover:text-white'
              }`}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {item.name}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 border-t border-white/10 pt-4 mx-3">
        <p className="px-3 mb-2 text-[11px] font-semibold text-white/35 uppercase tracking-wide">
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
              className={`flex items-center gap-3 min-h-[38px] px-3 rounded-md text-sm transition-colors ${
                active ? 'bg-white/10 text-white font-medium' : 'text-white/48 hover:bg-white/[0.06] hover:text-white/85'
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
          className="mt-3 flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-white/45 hover:bg-white/[0.06] hover:text-white/80 min-h-[38px] transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
