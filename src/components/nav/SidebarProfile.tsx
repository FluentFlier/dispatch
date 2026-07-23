'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, Moon, Settings, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { useTheme } from '@/components/theme/ThemeProvider';
import WorkspaceSwitcher from '@/components/nav/WorkspaceSwitcher';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 focus-visible:ring-offset-2';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Bottom-of-sidebar identity chip: avatar + name, click/hover opens a popover
 * with Settings, a dark-mode toggle, and Sign out. Replaces the old standalone
 * Settings row + Sign-out button.
 */
export default function SidebarProfile({ expanded }: { expanded: boolean }) {
  const { theme, toggle } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = getInsforgeClient();
        const { data } = await client.auth.getCurrentUser();
        const u = data?.user;
        if (!u?.id || cancelled) return;
        setEmail(u.email ?? '');
        const { data: prof } = await client.database
          .from('creator_profile')
          .select('display_name')
          .eq('user_id', u.id)
          .maybeSingle();
        if (!cancelled) setName((prof?.display_name as string) || u.email || 'Your account');
      } catch {
        /* session lag - the chip just shows a fallback until next load */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-update the chip when Settings saves a new display name.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const next = (e as CustomEvent<{ displayName?: string }>).detail?.displayName;
      if (next) setName(next);
    };
    window.addEventListener('profile-updated', onUpdate);
    return () => window.removeEventListener('profile-updated', onUpdate);
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const displayName = name || email || 'Your account';

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
        className={`flex w-full items-center overflow-hidden rounded-lg text-sm text-ink transition-colors hover:bg-white/60 ${FOCUS} ${
          expanded ? 'gap-2.5 px-2 py-2' : 'justify-center px-2 py-2'
        }`}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-semibold text-paper">
          {initials(displayName)}
        </span>
        {expanded && (
          <span className="min-w-0 flex-1 text-left">
            <span className="block truncate text-[13px] font-medium leading-tight text-ink">
              {displayName}
            </span>
            {email && (
              <span className="block truncate text-[11px] leading-tight text-ink3">{email}</span>
            )}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            role="menu"
            className="absolute bottom-full left-0 z-50 mb-2 w-60 rounded-xl border border-hair bg-surface p-1 shadow-card backdrop-blur-xl"
          >
            <div className="px-1 pb-1 pt-0.5">
              <WorkspaceSwitcher />
            </div>
            <div className="mb-1 border-t border-hair" />
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink transition-colors hover:bg-paper2 ${FOCUS}`}
            >
              <Settings className="h-4 w-4 shrink-0 text-ink3" />
              Settings
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={toggle}
              className={`flex w-full items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-[13px] text-ink transition-colors hover:bg-paper2 ${FOCUS}`}
            >
              <span className="flex items-center gap-2.5">
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 shrink-0 text-ink3" />
                ) : (
                  <Moon className="h-4 w-4 shrink-0 text-ink3" />
                )}
                Dark mode
              </span>
              <span
                aria-hidden
                className={`relative h-4 w-7 rounded-full transition-colors ${
                  theme === 'dark' ? 'bg-accent-primary' : 'bg-hair2'
                }`}
              >
                {/* Explicit left/right anchoring: off = knob left (grey),
                    on = knob right (blue). Avoids the static-position ambiguity
                    that made translate-x land on the wrong side. */}
                <span
                  style={{ backgroundColor: '#fff' }}
                  className={`absolute top-0.5 h-3 w-3 rounded-full shadow-sm transition-all ${
                    theme === 'dark' ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </span>
            </button>
            <div className="my-1 border-t border-hair" />
            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium text-flame transition-colors hover:bg-flame/10 ${FOCUS}`}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

async function handleSignOut() {
  await getInsforgeClient().auth.signOut();
  await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
  window.location.href = '/login';
}
