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
import { APP_HOME_PATH } from '@/lib/nav-config';
import { mustSubscribe } from '@/lib/trial';
import TrialBanner from '@/components/billing/TrialBanner';
import DashboardShell from '@/components/layout/DashboardShell';
import SchemaSetupRequired from '@/components/layout/SchemaSetupRequired';
import {
  checkCoreSchemaSetup,
  isMissingRelationError,
  isSchemaMismatchError,
} from '@/lib/db/setup-gate';

export const metadata = {
  robots: { index: false, follow: false },
};

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

  const sessionKeepAlive = <SessionKeepAlive />;

  const isOnboarding =
    pathname === '/onboarding' || pathname.startsWith('/onboarding/');

  if (pathname !== '/teleprompter') {
    try {
      const client = getServerClient();
      const setup = await checkCoreSchemaSetup(client);
      if (!setup.ok) {
        return (
          <ToastProvider>
            {sessionKeepAlive}
            <SchemaSetupRequired />
          </ToastProvider>
        );
      }

      const [profileRes, sub] = await Promise.all([
        client.database
          .from('creator_profile')
          .select('onboarding_complete')
          .eq('user_id', user.id)
          .maybeSingle(),
        getOrCreateSubscription(user.id),
      ]);

      if (profileRes.error && (isMissingRelationError(profileRes.error) || isSchemaMismatchError(profileRes.error))) {
        return (
          <ToastProvider>
            {sessionKeepAlive}
            <SchemaSetupRequired />
          </ToastProvider>
        );
      }

      if (mustSubscribe(sub)) {
        redirect('/pricing?trial=expired');
      }

      const nextPath = getPostAuthPath(profileRes.data, sub);

      if (isOnboarding) {
        if (nextPath === '/get-started') redirect('/auth/continue');
        if (nextPath === APP_HOME_PATH) redirect(APP_HOME_PATH);
      } else {
        const destination = nextPath === '/get-started' ? '/auth/continue' : nextPath;
        if (destination !== APP_HOME_PATH) redirect(destination);
      }
    } catch (err) {
      if (isMissingRelationError(err) || isSchemaMismatchError(err)) {
        return (
          <ToastProvider>
            {sessionKeepAlive}
            <SchemaSetupRequired />
          </ToastProvider>
        );
      }
      throw err;
    }
  }

  if (isOnboarding) {
    return (
      <ToastProvider>
        {sessionKeepAlive}
        <div className="editorial min-h-screen bg-paper text-ink">
          <main className="min-h-screen">{children}</main>
        </div>
      </ToastProvider>
    );
  }

  if (pathname === '/teleprompter') {
    return (
      <ToastProvider>
        {sessionKeepAlive}
        {children}
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      {sessionKeepAlive}
      <DashboardShell>
        <Sidebar />
        <main className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-6 pb-24 transition-[margin-left] duration-300 md:ml-[var(--sidebar-w,264px)] md:px-8 md:pb-8">
          <div className="mx-auto w-full max-w-[1560px]">
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
