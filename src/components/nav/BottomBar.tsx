'use client';

import { useState, useEffect, useCallback, type ComponentType } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  FileText,
  Home,
  Lightbulb,
  Menu,
  MessageSquare,
  PenLine,
  Settings,
  SlidersHorizontal,
  Target,
} from 'lucide-react';
import { primaryNav, moreNav } from '@/lib/nav-config';

const navIcons: Record<string, ComponentType<{ className?: string }>> = {
  '/dashboard': Home,
  '/generate': PenLine,
  '/library': FileText,
  '/calendar': CalendarDays,
  '/inbox': MessageSquare,
  '/leads': Target,
  '/ideas': Lightbulb,
  '/voice-lab': SlidersHorizontal,
  '/analytics': BarChart3,
  '/settings': Settings,
};

export default function BottomBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const closeMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMore();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [moreOpen, closeMore]);

  const isMoreActive = moreNav.some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <>
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/15 md:hidden"
          onClick={closeMore}
        />
      )}

      {moreOpen && (
        <div className="fixed bottom-16 left-0 right-0 z-40 md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="mx-3 mb-2 animate-slide-in space-y-1 rounded-xl border border-hair bg-white/95 p-3 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.25)] backdrop-blur-xl">
            {moreNav.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex min-h-[44px] items-center rounded-lg px-4 py-3 text-[15px] font-medium ${
                    isActive
                      ? 'bg-blue/10 text-blue'
                      : 'text-ink2'
                  }`}
                  onClick={closeMore}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-hair bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="flex h-16 items-stretch justify-around">
          {primaryNav.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = navIcons[item.href];
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
                  isActive ? 'text-blue' : 'text-ink3'
                }`}
                onClick={() => moreOpen && closeMore()}
              >
                <Icon className="h-4 w-4" />
                <span className="leading-none">{item.short}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((p) => !p)}
            className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium ${
              moreOpen || isMoreActive ? 'text-blue' : 'text-ink3'
            }`}
          >
            <Menu className="h-4 w-4" />
            <span className="leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
