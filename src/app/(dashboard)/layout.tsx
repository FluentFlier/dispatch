import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ToastProvider } from '@/components/ui/Toast';
import DashboardShell from '@/components/layout/DashboardShell';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';

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

  return (
    <ToastProvider>
      <DashboardShell>{children}</DashboardShell>
    </ToastProvider>
  );
}
