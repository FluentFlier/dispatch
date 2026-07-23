'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CornerDownLeft, FileText, Search, Settings as SettingsIcon, Layout } from 'lucide-react';
import { searchStatic, type SearchEntry } from '@/lib/search-index';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import type { Post } from '@/lib/types';

/** Dispatch this to open the palette from anywhere (e.g. the sidebar search box). */
export const OPEN_PALETTE_EVENT = 'open-command-palette';

interface Result {
  key: string;
  title: string;
  crumb: string;
  href: string;
  group: 'Pages' | 'Settings' | 'Posts';
}

function toResult(e: SearchEntry): Result {
  return {
    key: `${e.group}:${e.href}:${e.label}`,
    title: e.label,
    crumb: e.crumb,
    href: e.href,
    group: e.group === 'Page' ? 'Pages' : 'Settings',
  };
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setPosts([]);
    setActive(0);
  }, []);

  // Global open triggers: Cmd/Ctrl+K, and the sidebar search box event.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Static (page/settings) matches are instant.
  const staticResults = useMemo(() => searchStatic(query).map(toResult), [query]);

  // Post titles are searched server-side, debounced.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setPosts([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`/api/posts?q=${encodeURIComponent(q)}&limit=6`);
        if (!res.ok) return;
        const data = await res.json();
        setPosts(
          ((data.posts as Post[]) ?? []).map((p) => ({
            key: `Posts:${p.id}`,
            title: p.title || 'Untitled',
            crumb: 'Posts',
            href: `/library?post=${p.id}`,
            group: 'Posts' as const,
          })),
        );
      } catch {
        /* network hiccup - just show the static matches */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [query]);

  const results = useMemo(() => [...staticResults, ...posts], [staticResults, posts]);

  // Keep the active index in range as results change.
  useEffect(() => {
    setActive((i) => (i >= results.length ? 0 : i));
  }, [results.length]);

  const go = useCallback(
    (r: Result | undefined) => {
      if (!r) return;
      close();
      router.push(r.href);
    },
    [router, close],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  // Group results while keeping a flat index for arrow navigation.
  const groups: Result['group'][] = ['Pages', 'Settings', 'Posts'];
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-hair bg-surface shadow-card"
      >
        <div className="flex items-center gap-2.5 border-b border-hair px-4">
          <Search className="h-4 w-4 shrink-0 text-ink3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, settings, posts…"
            className="w-full bg-transparent py-3.5 text-[14px] text-ink placeholder:text-ink3 focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-hair px-1.5 py-0.5 text-[10px] text-ink3 sm:block">
            Esc
          </kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-2">
          {query.trim() === '' ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink3">
              Type to search across pages, settings, and your posts.
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink3">No matches for “{query}”.</p>
          ) : (
            groups.map((group) => {
              const items = results.filter((r) => r.group === group);
              if (items.length === 0) return null;
              const Icon = group === 'Posts' ? FileText : group === 'Settings' ? SettingsIcon : Layout;
              return (
                <div key={group} className="mb-1">
                  <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink3">
                    {group}
                  </p>
                  {items.map((r) => {
                    flatIndex += 1;
                    const isActive = flatIndex === active;
                    const idx = flatIndex;
                    return (
                      <button
                        key={r.key}
                        type="button"
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(r)}
                        className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors ${
                          isActive ? 'bg-paper2' : 'hover:bg-paper2'
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-ink3" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-ink">
                            {r.title}
                          </span>
                          {r.crumb !== r.title && (
                            <span className="block truncate text-[11px] text-ink3">{r.crumb}</span>
                          )}
                        </span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink3" />}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
