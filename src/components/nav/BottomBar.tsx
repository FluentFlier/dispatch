'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { primaryNav, moreNav } from '@/lib/nav-config';

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
          className="fixed inset-0 z-40 bg-text-primary/20 md:hidden"
          onClick={closeMore}
        />
      )}

      {moreOpen && (
        <div className="fixed bottom-16 left-0 right-0 z-40 md:hidden pb-[env(safe-area-inset-bottom)]">
          <div className="mx-3 mb-2 rounded-lg bg-bg-secondary border border-border p-3 space-y-1 shadow-card animate-slide-in">
            {moreNav.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`flex items-center px-4 py-3 rounded-md min-h-[44px] text-[15px] font-medium ${
                    isActive
                      ? 'bg-coral-light text-accent-primary'
                      : 'text-text-secondary'
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

      <nav className="fixed bottom-0 left-0 right-0 md:hidden bg-bg-secondary border-t border-border z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around h-16">
          {primaryNav.map((item) => {
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5 text-xs font-medium ${
                  isActive ? 'text-accent-primary' : 'text-text-tertiary'
                }`}
                onClick={() => moreOpen && closeMore()}
              >
                <span className="text-[15px] leading-none">{item.short}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen((p) => !p)}
            className={`flex flex-col items-center justify-center flex-1 min-h-[44px] text-xs font-medium ${
              moreOpen || isMoreActive ? 'text-accent-primary' : 'text-text-tertiary'
            }`}
          >
            <span className="text-[15px] leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
