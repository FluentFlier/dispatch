import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/nav/Sidebar';
import BottomBar from '@/components/nav/BottomBar';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAuthenticatedUser } from '@/lib/insforge/server';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') || '';
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect('/login?expired=1');
  }

  if (pathname === '/teleprompter') {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <div className="flex h-screen min-h-screen bg-bg-primary text-text-primary">
        <Sidebar />
        <main className="flex-1 md:ml-[240px] overflow-y-auto overflow-x-hidden px-4 md:px-8 py-6 pb-24 md:pb-8 min-w-0 w-full">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <BottomBar />
      </div>
    </ToastProvider>
  );
}
