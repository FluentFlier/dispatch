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
  Ticket,
} from 'lucide-react';
import { PRODUCT_NAME } from '@/lib/brand';
import DashboardShell from '@/components/layout/DashboardShell';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/subscriptions', label: 'Billing', icon: CreditCard },
  { href: '/admin/trial-codes', label: 'Trial codes', icon: Ticket },
  { href: '/admin/publish', label: 'Publish Queue', icon: Send },
  { href: '/admin/flags', label: 'Feature Flags', icon: Flag },
  { href: '/admin/usage', label: 'Usage', icon: BarChart3 },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/cron', label: 'Cron history', icon: Clock },
  { href: '/admin/stripe', label: 'Stripe', icon: Webhook },
  { href: '/admin/system', label: 'System', icon: Server },
] as const;

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue/30 focus-visible:ring-offset-2';

interface AdminShellProps {
  children: React.ReactNode;
  adminEmail: string;
}

/** Admin layout - same silk + paper chrome as the creator dashboard. */
export function AdminShell({ children, adminEmail }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <DashboardShell>
      <aside className="fixed bottom-0 left-0 top-0 z-40 hidden h-screen w-[264px] flex-col border-r border-hair bg-paper2/90 backdrop-blur-xl md:flex">
        <div className="border-b border-hair px-4 pb-4 pt-5">
          <Link
            href="/admin"
            className={`flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/70 ${FOCUS}`}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-hair bg-white text-[15px] font-semibold text-ink shadow-sm">
              /
            </span>
            <span>
              <span className="block text-[16px] font-semibold leading-tight tracking-[-0.02em] text-ink">
                {PRODUCT_NAME.toLowerCase()}.
              </span>
              <span className="block text-[11px] leading-tight text-ink3">Admin console</span>
            </span>
          </Link>
          <p className="mt-3 truncate px-2 text-[11px] text-ink3" title={adminEmail}>
            {adminEmail}
          </p>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-3">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const exact = 'exact' in rest && rest.exact;
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[40px] items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors ${FOCUS} ${
                  active
                    ? 'border border-hair2 bg-white text-ink shadow-sm'
                    : 'text-ink2 hover:bg-white/60 hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-hair p-3">
          <Link
            href="/dashboard"
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-ink3 transition-colors hover:bg-white/50 hover:text-ink2 ${FOCUS}`}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to {PRODUCT_NAME}
          </Link>
        </div>
      </aside>

      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col md:ml-[264px]">
        <header className="flex items-center justify-between border-b border-hair bg-paper/95 px-4 py-3 backdrop-blur-xl md:hidden">
          <span className="font-semibold text-ink">{PRODUCT_NAME} Admin</span>
          <Link href="/dashboard" className="text-xs text-ink2">
            Exit
          </Link>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <div className="mx-auto w-full max-w-[1100px]">{children}</div>
        </main>
      </div>
    </DashboardShell>
  );
}
