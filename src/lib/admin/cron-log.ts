import { getServiceClient } from '@/lib/insforge/server';

export type CronRunStatus = 'ok' | 'error' | 'partial';

export interface CronRunEntry {
  id: string;
  jobName: string;
  status: CronRunStatus;
  durationMs: number | null;
  summary: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
}

/**
 * Records a fan-out or child cron execution for ops visibility.
 * Swallows DB errors so cron delivery is never blocked by logging.
 */
export async function logCronRun(input: {
  jobName: string;
  status: CronRunStatus;
  durationMs?: number;
  summary?: Record<string, unknown>;
  errorMessage?: string;
}): Promise<void> {
  try {
    const client = getServiceClient();
    const { error } = await client.database.from('cron_run_log').insert([
      {
        job_name: input.jobName,
        status: input.status,
        duration_ms: input.durationMs ?? null,
        summary: input.summary ?? {},
        error_message: input.errorMessage ?? null,
      },
    ]);
    if (error) {
      console.warn('[cron-log] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[cron-log] unexpected error:', err);
  }
}

/**
 * Derives ok/partial/error from fan-out child results.
 */
export function cronStatusFromResults(
  results: Record<string, unknown>,
): { status: CronRunStatus; errorMessage?: string } {
  const values = Object.values(results);
  const errors = values.filter(
    (v) => v != null && typeof v === 'object' && 'error' in (v as object),
  );
  if (errors.length === values.length && values.length > 0) {
    return { status: 'error', errorMessage: 'All sub-jobs failed' };
  }
  if (errors.length > 0) {
    return { status: 'partial', errorMessage: `${errors.length} sub-job(s) failed` };
  }
  return { status: 'ok' };
}

/**
 * Lists recent cron runs for the admin cron page.
 */
export async function getAdminCronRuns(limit = 100): Promise<CronRunEntry[]> {
  const client = getServiceClient();
  const { data, error } = await client.database
    .from('cron_run_log')
    .select('id, job_name, status, duration_ms, summary, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    jobName: row.job_name as string,
    status: row.status as CronRunStatus,
    durationMs: (row.duration_ms as number | null) ?? null,
    summary: (row.summary as Record<string, unknown>) ?? {},
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}
