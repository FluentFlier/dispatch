import { AdminShell } from '@/components/admin/AdminShell';
import { ToastProvider } from '@/components/ui/Toast';

/** UI kit — admin screens available without production allowlist. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminShell adminEmail="admin@example.com">{children}</AdminShell>
    </ToastProvider>
  );
}
