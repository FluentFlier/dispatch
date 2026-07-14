/**
 * One-time setup: creates/updates the two cron jobs on cron-job.org via REST API.
 *
 * Required env vars:
 *   CRONJOB_ORG_API_KEY   - from cron-job.org → Settings → API keys
 *   CRONJOB_APP_URL       - production URL, e.g. https://contentos.us (InsForge)
 *   CRON_SECRET           - same secret set in hosting env vars
 *
 * NOTE: Use CRONJOB_APP_URL (not NEXT_PUBLIC_APP_URL) so localhost never leaks in.
 *
 * Run:
 *   CRONJOB_APP_URL=https://contentos.us npx tsx --env-file=.env.local scripts/setup-cronjobs.ts
 */

const CRONJOB_API = 'https://api.cron-job.org';

const API_KEY = process.env.CRONJOB_ORG_API_KEY;
// Prefer explicit CRONJOB_APP_URL over NEXT_PUBLIC_APP_URL to avoid localhost
const APP_URL = (process.env.CRONJOB_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!API_KEY || !CRON_SECRET) {
  console.error('Missing env vars: CRONJOB_ORG_API_KEY, CRON_SECRET');
  process.exit(1);
}

if (!APP_URL || APP_URL.includes('localhost')) {
  console.error(
    'APP_URL is missing or points to localhost.\n' +
    'Pass your real Vercel URL:\n' +
    '  CRONJOB_APP_URL=https://your-app.vercel.app npx tsx --env-file=.env.local scripts/setup-cronjobs.ts',
  );
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const JOBS = [
  {
    title: 'dispatch-fast',
    url: `${APP_URL}/api/cron/fast`,
    schedule: {
      timezone: 'UTC',
      expiresAt: 0,
      hours: [-1],
      mdays: [-1],
      months: [-1],
      wdays: [-1],
      minutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
    },
  },
  {
    title: 'dispatch-medium',
    url: `${APP_URL}/api/cron/medium`,
    schedule: {
      timezone: 'UTC',
      expiresAt: 0,
      hours: [-1],
      mdays: [-1],
      months: [-1],
      wdays: [-1],
      minutes: [0, 15, 30, 45],
    },
  },
];

function buildJobBody(job: (typeof JOBS)[0]) {
  return {
    job: {
      enabled: true,
      title: job.title,
      url: job.url,
      saveResponses: true,
      requestMethod: 0,
      requestTimeout: 300,
      schedule: job.schedule,
      extendedData: {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
      },
      notification: {
        onFailure: true,
        onFailureCount: 3,
        onSuccess: false,
        onDisable: true,
      },
    },
  };
}

async function createJob(job: (typeof JOBS)[0]): Promise<number> {
  const res = await fetch(`${CRONJOB_API}/jobs`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(buildJobBody(job)),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json() as { jobId: number };
  return data.jobId;
}

async function updateJob(jobId: number, job: (typeof JOBS)[0]): Promise<void> {
  const res = await fetch(`${CRONJOB_API}/jobs/${jobId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(buildJobBody(job)),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

async function listExisting(): Promise<Array<{ jobId: number; title: string; url: string }>> {
  const res = await fetch(`${CRONJOB_API}/jobs`, { headers });
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
  const data = await res.json() as { jobs: Array<{ jobId: number; title: string; url: string }> };
  return data.jobs;
}

async function main() {
  console.log(`Using app URL: ${APP_URL}\n`);
  console.log('Fetching existing cron-job.org jobs...');
  const existing = await listExisting();

  for (const job of JOBS) {
    await sleep(1500); // respect 1 req/sec create limit

    const match = existing.find((j) => j.title === job.title);

    if (match) {
      if (match.url === job.url) {
        console.log(`  SKIP   ${job.title} (jobId: ${match.jobId}) - URL already correct`);
      } else {
        console.log(`  UPDATE ${job.title} (jobId: ${match.jobId}) - fixing URL: ${match.url} → ${job.url}`);
        await updateJob(match.jobId, job);
        console.log(`         done`);
      }
    } else {
      const jobId = await createJob(job);
      console.log(`  CREATE ${job.title} → jobId: ${jobId} | ${job.url}`);
    }
  }

  console.log('\nDone. Verify at: https://console.cron-job.org');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
