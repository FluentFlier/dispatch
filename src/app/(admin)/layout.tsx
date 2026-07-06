import { redirect } from 'next/navigation';
import { assertAdmin, AdminError } from '@/lib/admin';
import { AdminShell } from '@/components/admin/AdminShell';
import { ToastProvider } from '@/components/ui/Toast';

export const dynamic = 'force-dynamic';

/**
 * Admin route group layout.
 * Skips creator onboarding gate; requires ADMIN_EMAILS allowlist instead.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let admin;
  try {
    admin = await assertAdmin();
  } catch (err) {
    if (err instanceof AdminError && err.status === 401) redirect('/login');
    redirect('/dashboard');
  }

  return (
    <ToastProvider>
      <AdminShell adminEmail={admin.email}>{children}</AdminShell>
    </ToastProvider>
  );
}
