'use client';

import { type ComponentType } from 'react';
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
  Radio,
  Settings,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { primaryNav, moreNav } from '@/lib/nav-config';
import WorkspaceSwitcher from '@/components/nav/WorkspaceSwitcher';

const navIcons: Record<string, ComponentType<{ className?: string }>> = {
  '/dashboard': Home,
  '/generate': PenLine,
  '/library': FileText,
  '/calendar': CalendarDays,
  '/inbox': MessageSquare,
  '/signals': Radio,
  '/leads': Target,
  '/event-capture': CalendarDays,
  '/ideas': Lightbulb,
  '/voice-lab': SlidersHorizontal,
  '/analytics': BarChart3,
  '/settings': Settings,
};

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    await getInsforgeClient().auth.signOut();
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    window.location.href = '/login';
  };

  return (
    <aside className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 w-[264px] h-screen z-40 bg-[#101312] text-white border-r border-black/10">
      <div className="px-4 pt-5 pb-4">
        <Link href="/dashboard" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5 transition-colors">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white font-mono text-sm text-[#101312]">
            /
          </span>
          <span>
            <span className="block font-mono text-[13px] font-medium tracking-[0.16em] leading-tight">
              CONTENT&nbsp;OS
            </span>
            <span className="block font-mono text-[10px] tracking-[0.06em] text-white/45 leading-tight">
              Creator operating system
            </span>
          </span>
        </Link>
        <WorkspaceSwitcher />
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
        <p className="px-3 mb-2 font-mono text-[10px] text-white/35 uppercase tracking-[0.16em]">
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
