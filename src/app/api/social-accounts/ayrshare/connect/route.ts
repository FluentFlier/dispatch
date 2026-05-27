import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getSocialProvider } from '@/lib/social';
import { getSocialProviderMode } from '@/lib/env';

/** GET: Redirect to Ayrshare social linking UI */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (getSocialProviderMode() !== 'ayrshare') {
    return NextResponse.json(
      { error: 'Ayrshare is not enabled. Set AYRSHARE_API_KEY or SOCIAL_PROVIDER_MODE=ayrshare.' },
      { status: 400 }
    );
  }

  const provider = getSocialProvider();
  if (!provider.getConnectUrl) {
    return NextResponse.json({ error: 'Provider does not support connect URL' }, { status: 400 });
  }

  const url = await provider.getConnectUrl(user.id);
  if (!url) {
    return NextResponse.json({ error: 'Could not generate connect URL' }, { status: 500 });
  }

  return NextResponse.redirect(url);
}
