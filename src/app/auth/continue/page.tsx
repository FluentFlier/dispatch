import { redirect } from 'next/navigation';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { getPostAuthPath } from '@/lib/auth-routing';

/**
 * Post-auth router: sends users to code entry, profile setup, or the app.
 * New users have no trial until they redeem an access code at /get-started.
 */
export default async function AuthContinuePage() {
  const user = await getAuthenticatedUser();
  if (!user) {
    // Reached here only because a content-os-token cookie exists (middleware sent
    // us). No valid user means it's expired/invalid - route to the ?expired=1
    // escape hatch so middleware lets /login render instead of bouncing us back
    // to /auth/continue in an infinite loop.
    redirect('/login?expired=1');
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

  const nextPath = getPostAuthPath(profileRes.data, sub);

  if (nextPath === '/pricing') {
    redirect('/pricing?trial=expired');
  }

  // '/get-started' is now the access-code entry page (no auto-trial).
  redirect(nextPath);
}
