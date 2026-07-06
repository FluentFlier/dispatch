import { headers, cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/nav/Sidebar';
import BottomBar from '@/components/nav/BottomBar';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAuthenticatedUser, getServerClient, getSessionUser } from '@/lib/insforge/server';
import { AUTH_COOKIE } from '@/lib/auth-cookies';
import { getImpersonationContext } from '@/lib/admin/impersonation';
import { ImpersonationBanner } from '@/components/admin/ImpersonationBanner';
import TokenRefreshGate from '@/components/auth/TokenRefreshGate';
import SessionKeepAlive from '@/components/auth/SessionKeepAlive';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';
import { mustSubscribe } from '@/lib/trial';
import TrialBanner from '@/components/billing/TrialBanner';
import DashboardShell from '@/components/layout/DashboardShell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = headers();
  const pathname = headersList.get('x-pathname') || '';
  const user = await getAuthenticatedUser();
  const sessionUser = await getSessionUser();
  const impersonation = await getImpersonationContext(sessionUser);

  if (!user) {
    const cookieStore = cookies();
    const hasToken = !!cookieStore.get(AUTH_COOKIE.access)?.value;
    if (!hasToken) {
      redirect('/login');
    }
    return <TokenRefreshGate />;
  }

  const isGetStarted = pathname === '/get-started';
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
        <div className="editorial min-h-screen bg-paper text-ink">
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
      <DashboardShell>
        <Sidebar />
        <main className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 pb-24 md:ml-[264px] md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-[1100px]">
          {impersonation ? (
            <ImpersonationBanner
              targetDisplayName={impersonation.targetDisplayName}
              targetUserId={impersonation.targetUserId}
            />
          ) : null}
          <TrialBanner />
          <ErrorBoundary>{children}</ErrorBoundary>
          </div>
        </main>
        <BottomBar />
      </DashboardShell>
    </ToastProvider>
  );
}
