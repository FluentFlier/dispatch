'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { PRODUCT_NAME } from '@/lib/brand';
import { primaryNav, moreNav, settingsNav, navIcons, APP_HOME_PATH } from '@/lib/nav-config';
import WorkspaceSwitcher from '@/components/nav/WorkspaceSwitcher';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 focus-visible:ring-offset-2';

const RAIL_WIDTH = 72;
const OPEN_WIDTH = 264;

// Labels fade + slide in when the rail expands.
const label = {
  collapsed: { opacity: 0, x: -6 },
  open: { opacity: 1, x: 0, transition: { duration: 0.18, delay: 0.05 } },
};

export default function Sidebar() {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(true);
  // Advanced menu: click-to-pin OR hover-to-peek. Stays open while you're on one
  // of its pages; a hover that selects nothing collapses back on mouse-leave.
  const [advPinned, setAdvPinned] = useState(false);
  const [advHovered, setAdvHovered] = useState(false);
  const activeInMore = moreNav.some(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  const advOpen = advPinned || advHovered || activeInMore;

  // Push the page content instead of overlaying it: the main region reads
  // --sidebar-w (see the dashboard layout) so its left margin tracks the rail.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-w',
      `${expanded ? OPEN_WIDTH : RAIL_WIDTH}px`,
    );
  }, [expanded]);

  const handleSignOut = async () => {
    await getInsforgeClient().auth.signOut();
    await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
    window.location.href = '/login';
  };

  const renderItem = (item: { href: string; name: string }, small: boolean) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    const Icon = navIcons[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.name}
        className={`flex items-center overflow-hidden rounded-lg text-sm transition-colors ${FOCUS} ${
          small ? 'min-h-[38px]' : 'min-h-[40px] font-medium'
        } ${expanded ? 'gap-3 px-3' : 'justify-center px-2'} ${
          active
            ? small
              ? 'bg-white/80 font-medium text-ink'
              : 'border border-hair2 bg-white text-ink shadow-sm'
            : small
              ? 'text-ink hover:bg-white/60'
              : 'text-ink hover:bg-white/60'
        }`}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        {expanded && (
          <motion.span variants={label} initial="collapsed" animate="open" className="whitespace-nowrap">
            {item.name}
          </motion.span>
        )}
      </Link>
    );
  };

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? OPEN_WIDTH : RAIL_WIDTH }}
      transition={{ type: 'spring', stiffness: 260, damping: 30, mass: 0.7 }}
      className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 z-40 h-screen overflow-x-hidden overflow-y-auto border-r border-hair bg-paper2/90 backdrop-blur-xl"
    >
      {/* Top: logo + minimize/expand toggle */}
      <div
        className={`flex px-3 pt-4 ${
          expanded ? 'items-center justify-between' : 'flex-col items-center gap-2'
        }`}
      >
        <Link
          href={APP_HOME_PATH}
          title={PRODUCT_NAME}
          className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-white/70 ${FOCUS} ${
            expanded ? '' : 'justify-center'
          }`}
        >
          <Image
            src="/logo-paper-rocket-bw-transparent.svg"
            alt={PRODUCT_NAME}
            width={26}
            height={26}
            className="h-[26px] w-[26px] shrink-0"
            priority
          />
          {expanded && (
            <span className="flex flex-col">
              <span className="whitespace-nowrap text-[20px] font-bold leading-none tracking-[-0.045em] text-ink">
                {PRODUCT_NAME.toLowerCase()}
              </span>
              <motion.span
                variants={label}
                initial="collapsed"
                animate="open"
                className="mt-1.5 block whitespace-nowrap text-[11px] leading-tight text-ink3"
              >
                Creator operating system
              </motion.span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Minimize menu' : 'Expand menu'}
          aria-label={expanded ? 'Minimize menu' : 'Expand menu'}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink transition-colors hover:bg-white/70 ${FOCUS}`}
        >
          {expanded ? <PanelLeftClose className="h-5 w-5" strokeWidth={2.5} /> : <PanelLeftOpen className="h-5 w-5" strokeWidth={2.5} />}
        </button>
      </div>

      {/* Workspace (icon when collapsed, full switcher when expanded) */}
      <div className="px-3">
        <WorkspaceSwitcher collapsed={!expanded} />
      </div>

      <nav className="mt-4 space-y-0.5 px-3">
        {primaryNav.map((item) => renderItem(item, false))}
      </nav>

      <div className={`mt-4 border-t border-hair pb-4 pt-4 ${expanded ? 'px-3' : 'mx-2 px-1'}`}>
        {expanded ? (
          <div
            onMouseEnter={() => setAdvHovered(true)}
            onMouseLeave={() => setAdvHovered(false)}
          >
            <button
              type="button"
              onClick={() => setAdvPinned((v) => !v)}
              aria-expanded={advOpen}
              title="Advanced"
              className={`flex min-h-[38px] w-full items-center gap-3 overflow-hidden rounded-lg px-3 text-sm text-ink transition-colors hover:bg-white/60 ${FOCUS}`}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              <motion.span variants={label} initial="collapsed" animate="open" className="whitespace-nowrap font-medium">
                Advanced
              </motion.span>
              <ChevronDown
                className={`ml-auto h-4 w-4 shrink-0 text-ink3 transition-transform ${advOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <AnimatePresence initial={false}>
              {advOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="mt-1 space-y-0.5 pl-2">
                    {moreNav.map((item) => renderItem(item, true))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="space-y-0.5">{moreNav.map((item) => renderItem(item, true))}</div>
        )}
        {/* Settings — standalone, always visible (not inside Advanced). */}
        <div className="mt-3">{renderItem(settingsNav, true)}</div>
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          className={`mt-0.5 flex min-h-[38px] w-full items-center overflow-hidden rounded-lg text-sm font-semibold text-ink transition-colors hover:bg-white/60 ${FOCUS} ${
            expanded ? 'gap-3 px-3 py-2' : 'justify-center px-2 py-2'
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          {expanded && (
            <motion.span variants={label} initial="collapsed" animate="open" className="whitespace-nowrap">
              Sign out
            </motion.span>
          )}
        </button>
      </div>
    </motion.aside>
  );
}
