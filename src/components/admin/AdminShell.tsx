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
} from 'lucide-react';

const NAV = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/subscriptions', label: 'Billing', icon: CreditCard },
  { href: '/admin/publish', label: 'Publish Queue', icon: Send },
  { href: '/admin/flags', label: 'Feature Flags', icon: Flag },
  { href: '/admin/usage', label: 'Usage', icon: BarChart3 },
  { href: '/admin/system', label: 'System', icon: Server },
] as const;

interface AdminShellProps {
  children: React.ReactNode;
  adminEmail: string;
}

/**
 * Admin layout shell with dark ops sidebar.
 * Separate from creator dashboard to avoid nav confusion.
 */
export function AdminShell({ children, adminEmail }: AdminShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#0f1117] text-[#e8eaed]">
      <aside className="hidden md:flex w-56 flex-col border-r border-[#2a2d35] bg-[#13151b] shrink-0">
        <div className="px-4 py-5 border-b border-[#2a2d35]">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#6b7280]">
            Dispatch Ops
          </p>
          <h1 className="text-lg font-semibold text-white mt-0.5">Admin</h1>
          <p className="text-[11px] text-[#6b7280] mt-1 truncate" title={adminEmail}>
            {adminEmail}
          </p>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {NAV.map(({ href, label, icon: Icon, ...rest }) => {
            const exact = 'exact' in rest && rest.exact;
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-[#2563eb]/20 text-[#93c5fd] font-medium'
                    : 'text-[#9ca3af] hover:bg-[#1f2229] hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-[#2a2d35]">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-xs text-[#6b7280] hover:text-[#9ca3af] px-2 py-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to app
          </Link>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[#2a2d35] bg-[#13151b]">
          <span className="font-semibold text-white">Admin</span>
          <Link href="/dashboard" className="text-xs text-[#6b7280]">
            Exit
          </Link>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
