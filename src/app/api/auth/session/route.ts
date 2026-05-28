import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getUserEntitlements } from '@/lib/entitlements';

/** GET: Current session + entitlements (for client bootstrapping) */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ authenticated: false });
  }

  const entitlements = await getUserEntitlements(user.id);

  return NextResponse.json({
    authenticated: true,
    user: { id: user.id, email: user.email },
    entitlements,
  });
}
