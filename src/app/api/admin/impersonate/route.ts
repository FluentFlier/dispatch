import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { logAdminAction } from '@/lib/admin/audit';
import { setImpersonationCookie, clearImpersonationCookie } from '@/lib/admin/impersonation';
import { getServiceClient } from '@/lib/insforge/server';

const BodySchema = z.object({
  userId: z.string().uuid(),
});

/**
 * POST /api/admin/impersonate - start support impersonation as target user.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const body: unknown = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const client = getServiceClient();
    const { data: profile } = await client.database
      .from('creator_profile')
      .select('user_id, display_name')
      .eq('user_id', parsed.data.userId)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const ok = setImpersonationCookie(admin, parsed.data.userId);
    if (!ok) {
      return NextResponse.json({ error: 'Impersonation not configured (missing signing key)' }, { status: 500 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'impersonate.start',
      targetType: 'user',
      targetId: parsed.data.userId,
      details: { displayName: profile.display_name },
    });

    return NextResponse.json({ ok: true, userId: parsed.data.userId });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/admin/impersonate - end active impersonation session.
 */
export async function DELETE(): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    clearImpersonationCookie();

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'impersonate.end',
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
