import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminUpdateSubscription, adminSetOnboarding } from '@/lib/admin-data';
import { logAdminAction } from '@/lib/admin/audit';

const BodySchema = z
  .object({
    plan: z.enum(['free', 'starter', 'growth', 'pro', 'unlimited']).optional(),
    status: z.enum(['inactive', 'trialing', 'active', 'past_due', 'canceled']).optional(),
    onboardingComplete: z.boolean().optional(),
  })
  .refine((d) => d.plan !== undefined || d.status !== undefined || d.onboardingComplete !== undefined, {
    message: 'At least one field required',
  });

/**
 * PATCH /api/admin/users/[userId] - manual subscription or onboarding override.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { userId: string } },
): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const body: unknown = await request.json();
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const { plan, status, onboardingComplete } = parsed.data;

    if (plan !== undefined || status !== undefined) {
      const subOk = await adminUpdateSubscription(params.userId, {
        ...(plan !== undefined ? { plan } : {}),
        ...(status !== undefined ? { status } : {}),
      });
      if (!subOk) {
        return NextResponse.json({ error: 'Subscription update failed' }, { status: 400 });
      }
      await logAdminAction({
        actorEmail: admin.email,
        actorUserId: admin.id,
        action: 'user.subscription_update',
        targetType: 'user',
        targetId: params.userId,
        details: { plan, status },
      });
    }

    if (onboardingComplete !== undefined) {
      const profileOk = await adminSetOnboarding(params.userId, onboardingComplete);
      if (!profileOk) {
        return NextResponse.json({ error: 'Profile update failed' }, { status: 400 });
      }
      await logAdminAction({
        actorEmail: admin.email,
        actorUserId: admin.id,
        action: 'user.onboarding_update',
        targetType: 'user',
        targetId: params.userId,
        details: { onboardingComplete },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
