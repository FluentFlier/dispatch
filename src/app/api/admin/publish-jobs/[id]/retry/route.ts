import { NextResponse } from 'next/server';
import { assertAdmin, adminErrorResponse } from '@/lib/admin';
import { adminRetryPublishJob } from '@/lib/admin-data';

/**
 * POST /api/admin/publish-jobs/[id]/retry — re-queue a failed/dead job.
 */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  try {
    await assertAdmin();
    const ok = await adminRetryPublishJob(params.id);
    if (!ok) {
      return NextResponse.json({ error: 'Job not found or not retryable' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { status, message } = adminErrorResponse(err);
    return NextResponse.json({ error: message }, { status });
  }
}
