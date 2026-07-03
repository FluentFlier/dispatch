import { redirect } from 'next/navigation';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';
import { startTrialForUser } from '@/lib/start-trial';

/**
 * Post-auth router: auto-starts trial for new users, then sends them to setup or app.
 */
export default async function AuthContinuePage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    redirect('/login');
  }

  const client = getServerClient();
  const [profileRes, sub] = await Promise.all([
    client.database
      .from('creator_profile')
      .select('onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle(),
    getOrCreateSubscription(user.id),
  ]);

  let nextPath = getPostAuthPath(profileRes.data, sub);

  if (nextPath === '/get-started') {
    const trial = await startTrialForUser(user.id);
    if (!trial.ok) {
      redirect('/pricing?trial=expired');
    }
    nextPath = getPostAuthPath(profileRes.data, await getOrCreateSubscription(user.id));
  }

  if (nextPath === '/pricing') {
    redirect('/pricing?trial=expired');
  }

  redirect(nextPath);
}
