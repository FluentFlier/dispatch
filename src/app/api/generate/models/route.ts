import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getWriteModelCatalog } from '@/lib/write-models';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const models = getWriteModelCatalog().map(({ id, label }) => ({ id, label }));
  return NextResponse.json({ models });
}
