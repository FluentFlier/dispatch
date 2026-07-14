import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminSetTrialCodeActive, adminDeleteTrialCode } from '@/lib/admin-data';
import { logAdminAction } from '@/lib/admin/audit';

const PatchSchema = z.object({ active: z.boolean() });

/**
 * PATCH /api/admin/trial-codes/[code] - enable/disable a code.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { code: string } },
): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const body: unknown = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const code = decodeURIComponent(params.code);
    const ok = await adminSetTrialCodeActive(code, parsed.data.active);
    if (!ok) {
      return NextResponse.json({ error: 'Update failed' }, { status: 400 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'trial_code.update',
      targetType: 'trial_code',
      targetId: code,
      details: { active: parsed.data.active },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/admin/trial-codes/[code] - permanently remove a code.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { code: string } },
): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const code = decodeURIComponent(params.code);
    const ok = await adminDeleteTrialCode(code);
    if (!ok) {
      return NextResponse.json({ error: 'Delete failed' }, { status: 400 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'trial_code.delete',
      targetType: 'trial_code',
      targetId: code,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
