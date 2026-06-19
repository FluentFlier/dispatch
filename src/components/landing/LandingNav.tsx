'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import { Menu, X } from 'lucide-react';
import { Magnetic } from './primitives';

const links = [
  { label: 'The loop', href: '#loop' },
  { label: 'Voice', href: '#voice' },
  { label: 'Everywhere', href: '#everywhere' },
  { label: 'Pricing', href: '/pricing' },
] as const;

export default function LandingNav({ loggedIn }: { loggedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-x-0 top-0 z-50 flex flex-col items-center px-4 pt-4"
    >
      <nav
        className={`flex w-full max-w-6xl items-center justify-between rounded-full px-4 py-2.5 transition-all duration-500 sm:px-5 ${
          scrolled || menuOpen
            ? 'border border-os-border bg-[rgba(13,15,19,0.72)] shadow-glass backdrop-blur-xl'
            : 'border border-transparent bg-transparent'
        }`}
      >
        <Link href="/" className="flex items-center gap-2.5" onClick={() => setMenuOpen(false)}>
          <span className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-os-coral/15 ring-1 ring-os-coral/30">
            <span className="h-2 w-2 rounded-sm bg-os-coral animate-os-pulse-dot" />
          </span>
          <span className="os-mono text-[12px] font-medium uppercase tracking-[0.28em] text-os-text">
            Content&nbsp;OS
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="text-[13.5px] text-os-soft/80 transition-colors hover:text-os-text"
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {loggedIn ? (
            <Link
              href="/dashboard"
              className="rounded-full bg-os-text px-4 py-2 text-[13px] font-semibold text-os-bg transition-transform hover:scale-[1.03]"
            >
              Open workspace
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-full px-4 py-2 text-[13px] font-medium text-os-soft transition-colors hover:text-os-text sm:inline-flex"
              >
                Sign in
              </Link>
              <Magnetic>
                <Link
                  href="/login"
                  className="group relative inline-flex items-center gap-1.5 overflow-hidden rounded-full bg-os-coral px-4 py-2 text-[13px] font-semibold text-os-bg"
                >
                  <span
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                    aria-hidden
                  />
                  Start free
                </Link>
              </Magnetic>
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-os-border text-os-soft transition-colors hover:text-os-text md:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </nav>

      {/* Mobile menu sheet */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mt-2 w-full max-w-6xl overflow-hidden rounded-3xl border border-os-border bg-[rgba(13,15,19,0.92)] p-2 shadow-glass backdrop-blur-xl md:hidden"
          >
            {links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-2xl px-4 py-3 text-[15px] text-os-soft transition-colors hover:bg-os-surface hover:text-os-text"
              >
                {l.label}
              </Link>
            ))}
            {!loggedIn && (
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="block rounded-2xl px-4 py-3 text-[15px] text-os-soft transition-colors hover:bg-os-surface hover:text-os-text sm:hidden"
              >
                Sign in
              </Link>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
