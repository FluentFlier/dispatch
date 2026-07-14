'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { PRODUCT_NAME } from '@/lib/brand';
import { primaryNav, moreNav, navIcons, APP_HOME_PATH } from '@/lib/nav-config';
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
              ? 'text-ink3 hover:bg-white/50 hover:text-ink2'
              : 'text-ink2 hover:bg-white/60 hover:text-ink'
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
          expanded ? 'items-start justify-between' : 'flex-col items-center gap-2'
        }`}
      >
        <Link
          href={APP_HOME_PATH}
          title={PRODUCT_NAME}
          className={`flex flex-col rounded-xl px-2 py-1.5 transition-colors hover:bg-white/70 ${FOCUS} ${
            expanded ? '' : 'items-center'
          }`}
        >
          <span className="whitespace-nowrap text-[20px] font-bold leading-none tracking-[-0.045em] text-ink">
            {expanded ? PRODUCT_NAME.toLowerCase() : PRODUCT_NAME.charAt(0).toLowerCase()}
            <span className="text-ink">.</span>
          </span>
          {expanded && (
            <motion.span
              variants={label}
              initial="collapsed"
              animate="open"
              className="mt-1.5 block whitespace-nowrap text-[11px] leading-tight text-ink3"
            >
              Creator operating system
            </motion.span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Minimize menu' : 'Expand menu'}
          aria-label={expanded ? 'Minimize menu' : 'Expand menu'}
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-white/70 hover:text-ink ${FOCUS}`}
        >
          {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </button>
      </div>

      {/* Workspace (icon when collapsed, full switcher when expanded) */}
      <div className="px-3">
        <WorkspaceSwitcher collapsed={!expanded} />
      </div>

      <nav className="mt-4 space-y-0.5 px-3">
        {primaryNav.map((item) => renderItem(item, false))}
      </nav>

      <div className={`mt-4 border-t border-hair pb-4 pt-4 ${expanded ? 'mx-3 px-3' : 'mx-2 px-1'}`}>
        {expanded && (
          <motion.p
            variants={label}
            initial="collapsed"
            animate="open"
            className="mb-2 whitespace-nowrap px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-ink3"
          >
            More
          </motion.p>
        )}
        <div className="space-y-0.5">{moreNav.map((item) => renderItem(item, true))}</div>
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          className={`mt-3 flex min-h-[38px] w-full items-center overflow-hidden rounded-lg text-sm text-ink3 transition-colors hover:bg-white/50 hover:text-ink2 ${FOCUS} ${
            expanded ? 'gap-3 px-3 py-2' : 'justify-center px-2 py-2'
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
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
