import { NextResponse } from 'next/server';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminRetryPublishJob } from '@/lib/admin-data';
import { logAdminAction } from '@/lib/admin/audit';

/**
 * POST /api/admin/publish-jobs/[id]/retry — re-queue a failed/dead job.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    const admin = await assertAdmin();
    const ok = await adminRetryPublishJob(params.id);
    if (!ok) {
      return NextResponse.json({ error: 'Job not found or not retryable' }, { status: 400 });
    }

    await logAdminAction({
      actorEmail: admin.email,
      actorUserId: admin.id,
      action: 'publish.retry',
      targetType: 'publish_job',
      targetId: params.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
