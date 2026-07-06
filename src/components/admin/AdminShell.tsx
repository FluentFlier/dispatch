'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Send,
  Flag,
  BarChart3,
  Server,
  ArrowLeft,
  ScrollText,
  Clock,
  Webhook,
} from 'lucide-react';
import { PRODUCT_NAME } from '@/lib/brand';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/subscriptions', label: 'Billing', icon: CreditCard },
  { href: '/admin/publish', label: 'Publish Queue', icon: Send },
  { href: '/admin/flags', label: 'Feature Flags', icon: Flag },
  { href: '/admin/usage', label: 'Usage', icon: BarChart3 },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/cron', label: 'Cron history', icon: Clock },
  { href: '/admin/stripe', label: 'Stripe', icon: Webhook },
  { href: '/admin/system', label: 'System', icon: Server },
] as const;

interface AdminShellProps {
  children: React.ReactNode;
  adminEmail: string;
}

/**
 * Admin layout shell — dark sidebar + light content, matching the creator dashboard.
 */
export function AdminShell({ children, adminEmail }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-bg-primary text-text-primary">
      <aside className="hidden md:flex md:flex-col fixed left-0 top-0 bottom-0 w-[264px] h-screen z-40 bg-[#101312] text-white border-r border-black/10 shrink-0">
        <div className="px-4 pt-5 pb-4 border-b border-white/10">
          <Link
            href="/admin"
            className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5 transition-colors"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white font-mono text-sm text-[#101312]">
              /
            </span>
            <span>
              <span className="block font-mono text-[13px] font-medium tracking-[0.16em] leading-tight">
                {PRODUCT_NAME.replace(' ', '\u00a0').toUpperCase()}
              </span>
              <span className="block font-mono text-[10px] tracking-[0.06em] text-white/45 leading-tight">
                Admin console
              </span>
            </span>
          </Link>
          <p className="text-[11px] text-white/40 mt-3 truncate px-2" title={adminEmail}>
            {adminEmail}
          </p>
        </div>
        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const exact = 'exact' in rest && rest.exact;
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-white/10 text-white font-medium'
                    : 'text-white/55 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xs text-white/45 hover:text-white/70 px-2 py-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to {PRODUCT_NAME}
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 md:ml-[264px]">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
          <span className="font-semibold text-text-primary">{PRODUCT_NAME} Admin</span>
          <Link href="/dashboard" className="text-xs text-text-secondary">
            Exit
          </Link>
        </header>
        <main className="flex-1 overflow-y-auto px-4 md:px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
