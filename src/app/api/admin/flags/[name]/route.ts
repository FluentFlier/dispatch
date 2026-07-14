import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminSetFeatureFlag } from '@/lib/admin-data';
import { logAdminAction } from '@/lib/admin/audit';

const BodySchema = z.object({
  enabled: z.boolean(),
});

/**
 * PATCH /api/admin/flags/[name] - toggle a feature flag.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { name: string } },
): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const body: unknown = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const ok = await adminSetFeatureFlag(params.name, parsed.data.enabled);
    if (!ok) {
      return NextResponse.json({ error: 'Flag not found or update failed' }, { status: 404 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'flag.toggle',
      targetType: 'feature_flag',
      targetId: params.name,
      details: { enabled: parsed.data.enabled },
    });

    return NextResponse.json({ ok: true, name: params.name, enabled: parsed.data.enabled });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
