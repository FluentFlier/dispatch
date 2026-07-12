import { AdminShell } from '@/components/admin/AdminShell';
import { ToastProvider } from '@/components/ui/Toast';

// Every admin page reads the session cookie via assertAdmin() and throws
// when unauthenticated — building it as a static shell makes `next build`
// attempt to prerender an unauthenticated request and fail. Force dynamic
// rendering for the whole (admin) segment so pages render per-request instead.
export const dynamic = 'force-dynamic';

/** UI kit — admin screens available without production allowlist. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <AdminShell adminEmail="admin@example.com">{children}</AdminShell>
    </ToastProvider>
  );
}
