import { AdminShell } from '@/components/admin/AdminShell';
import { ToastProvider } from '@/components/ui/Toast';

// Admin pages read auth cookies (assertAdmin) on every request; they can never
// be statically prerendered, and attempting it fails the build with
// "AdminError: Unauthenticated" (no cookies exist at build time).
export const dynamic = 'force-dynamic';

/** UI kit — admin screens available without production allowlist. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminShell adminEmail="admin@example.com">{children}</AdminShell>
    </ToastProvider>
  );
}
