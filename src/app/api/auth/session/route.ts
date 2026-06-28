import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getUserEntitlements } from '@/lib/entitlements';

/** GET: Current session + entitlements (for client bootstrapping) */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  const entitlements = await getUserEntitlements(user.id);
  const client = getServerClient();
  const [{ data: profile }, { data: prefRow }] = await Promise.all([
    client.database
      .from('creator_profile')
      .select('display_name, content_pillars, onboarding_complete')
      .eq('user_id', user.id)
      .maybeSingle(),
    client.database
      .from('user_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'preferred_post_length')
      .maybeSingle(),
  ]);

  return NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email },
    profile: profile
      ? {
          displayName: profile.display_name,
          contentPillars: profile.content_pillars,
          onboardingComplete: Boolean(profile.onboarding_complete),
        }
      : null,
    entitlements,
    preferredPostLength: (prefRow?.value ?? 'standard') as 'short' | 'standard' | 'long',
  });
}
