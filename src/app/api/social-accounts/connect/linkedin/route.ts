import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';

// GET: Legacy official LinkedIn OAuth entrypoint.
// LinkedIn/X connections now go through Unipile. Keep this route as a
// compatibility redirect so stale clients never fall into the unsupported
// direct LinkedIn credential path in production.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const redirectUrl = new URL('/api/social-accounts/connect/unipile', request.url);
  const returnTo = request.nextUrl.searchParams.get('return');
  if (returnTo) redirectUrl.searchParams.set('return', returnTo);
  return NextResponse.redirect(redirectUrl);
}
