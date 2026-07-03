import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/nav/Sidebar';
import BottomBar from '@/components/nav/BottomBar';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import TokenRefreshGate from '@/components/auth/TokenRefreshGate';
import SessionKeepAlive from '@/components/auth/SessionKeepAlive';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';
import { mustSubscribe } from '@/lib/trial';
import TrialBanner from '@/components/billing/TrialBanner';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') || '';
  const user = await getAuthenticatedUser();

  if (!user) {
    const cookieStore = cookies();
    const hasToken = !!cookieStore.get('content-os-token')?.value;
    if (!hasToken) {
      redirect('/login');
    }
    return <TokenRefreshGate />;
  }

  const isGetStarted =
    pathname === '/get-started' || pathname === '/book-demo';
  const isOnboarding =
    pathname === '/onboarding' || pathname.startsWith('/onboarding/');
  const isMinimalChrome = isGetStarted || isOnboarding || pathname === '/teleprompter';

  if (pathname !== '/teleprompter') {
    const client = getServerClient();
    const [profileRes, sub] = await Promise.all([
      client.database
        .from('creator_profile')
        .select('onboarding_complete')
        .eq('user_id', user.id)
        .maybeSingle(),
      getOrCreateSubscription(user.id),
    ]);

    if (mustSubscribe(sub)) {
      redirect('/pricing?trial=expired');
    }

    const nextPath = getPostAuthPath(profileRes.data, sub);

    if (isOnboarding) {
      if (nextPath === '/get-started') redirect('/auth/continue');
      if (nextPath === '/dashboard') redirect('/dashboard');
    } else if (!isGetStarted) {
      const destination = nextPath === '/get-started' ? '/auth/continue' : nextPath;
      if (destination !== '/dashboard') redirect(destination);
    }
  }

  if (isGetStarted || isOnboarding) {
    return (
      <ToastProvider>
        <div className="min-h-screen bg-bg-primary text-text-primary">
          <main className="min-h-screen">{children}</main>
        </div>
      </ToastProvider>
    );
  }

  if (pathname === '/teleprompter') {
    return <ToastProvider>{children}</ToastProvider>;
  }

  return (
    <ToastProvider>
      <SessionKeepAlive />
      <div className="flex h-screen min-h-screen bg-bg-primary text-text-primary">
        <Sidebar />
        <main className="flex-1 md:ml-[264px] overflow-y-auto overflow-x-hidden px-4 md:px-8 py-6 pb-24 md:pb-8 min-w-0 w-full">
          <TrialBanner />
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
        <BottomBar />
      </div>
    </ToastProvider>
  );
}
