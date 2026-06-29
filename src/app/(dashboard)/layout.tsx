import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/nav/Sidebar';
import BottomBar from '@/components/nav/BottomBar';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import TokenRefreshGate from '@/components/auth/TokenRefreshGate';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') || '';
  const user = await getAuthenticatedUser();

  if (!user) {
    // If no cookie at all, they're definitely not logged in.
    const cookieStore = cookies();
    const hasToken = !!cookieStore.get('content-os-token')?.value;
    if (!hasToken) {
      redirect('/login');
    }
    // Cookie exists but server-side validation failed (expired token).
    // Let the client attempt a browser-side refresh via InsForge's session cookie.
    return <TokenRefreshGate />;
  }

  const isOnboarding = pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  if (!isOnboarding && pathname !== '/teleprompter') {
    const client = getServerClient();
    const { data: profile } = await client.database
      .from('creator_profile')
      .select('onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.onboarding_complete) {
      redirect('/onboarding');
    }
  }

  if (pathname === '/teleprompter') {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <div className="flex h-screen min-h-screen bg-bg-primary text-text-primary">
        <Sidebar />
        <main className="flex-1 md:ml-[264px] overflow-y-auto overflow-x-hidden px-4 md:px-8 py-6 pb-24 md:pb-8 min-w-0 w-full">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <BottomBar />
      </div>
    </ToastProvider>
  );
}
