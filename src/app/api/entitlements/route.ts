import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getUserEntitlements } from '@/lib/entitlements';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const entitlements = await getUserEntitlements(user.id);
  return NextResponse.json(entitlements);
}
