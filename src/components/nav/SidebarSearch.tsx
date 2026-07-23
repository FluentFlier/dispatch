'use client';

import { Search } from 'lucide-react';
import { OPEN_PALETTE_EVENT } from '@/components/nav/CommandPalette';

const openPalette = () => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT));

/** Search entry point above the nav - opens the shared command palette. */
export default function SidebarSearch({ expanded }: { expanded: boolean }) {
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={openPalette}
        title="Search"
        aria-label="Search"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-ink outline-none transition-colors hover:bg-white/70 focus-visible:bg-white/70"
      >
        <Search className="h-4 w-4" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      className="flex w-full items-center gap-2.5 rounded-lg border border-hair bg-white/60 px-3 py-2 text-left text-[13px] text-ink3 outline-none transition-colors hover:border-hair2 hover:bg-white/80 focus-visible:border-blue/50"
    >
      <Search className="h-4 w-4 shrink-0" />
      <span className="flex-1">Search…</span>
    </button>
  );
}
