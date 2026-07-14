import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminCreateTrialCode } from '@/lib/admin-data';
import { TRIAL_CODE_PLANS } from '@/lib/trial-codes';
import { logAdminAction } from '@/lib/admin/audit';

const BodySchema = z.object({
  code: z.string().min(1).max(64),
  plan: z.enum(TRIAL_CODE_PLANS as [string, ...string[]]),
  trialDays: z.coerce.number().int().min(1).max(365),
  maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullish(),
  note: z.string().max(200).nullish(),
});

/**
 * POST /api/admin/trial-codes - create a reusable trial access code.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const body: unknown = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
    }

    const { code, plan, trialDays, maxRedemptions, note } = parsed.data;
    const result = await adminCreateTrialCode({
      code,
      plan,
      trialDays,
      maxRedemptions: maxRedemptions ?? null,
      note: note?.trim() ? note.trim() : null,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'trial_code.create',
      targetType: 'trial_code',
      targetId: result.code,
      details: { plan, trialDays, maxRedemptions: maxRedemptions ?? null },
    });

    return NextResponse.json({ ok: true, code: result.code });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
