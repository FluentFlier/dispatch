/**
 * One-time setup: creates the two cron jobs on cron-job.org via REST API.
 *
 * Required env vars (add to .env.local before running):
 *   CRONJOB_ORG_API_KEY   - from cron-job.org → Settings → API keys
 *   NEXT_PUBLIC_APP_URL   - your Vercel production URL (no trailing slash)
 *   CRON_SECRET           - same secret set in Vercel env vars
 *
 * Run once:
 *   npx tsx scripts/setup-cronjobs.ts
 */

const CRONJOB_API = 'https://api.cron-job.org';

const API_KEY = process.env.CRONJOB_ORG_API_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
const CRON_SECRET = process.env.CRON_SECRET;

if (!API_KEY || !APP_URL || !CRON_SECRET) {
  console.error('Missing env vars: CRONJOB_ORG_API_KEY, NEXT_PUBLIC_APP_URL, CRON_SECRET');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// cron-job.org schedule format:
// minutes/hours/mdays/months/wdays: array of ints, [-1] = wildcard (every)
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
      // Every 5 minutes
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
      // Every 15 minutes
      minutes: [0, 15, 30, 45],
    },
  },
];

async function createJob(job: (typeof JOBS)[0]): Promise<number> {
  const body = {
    job: {
      enabled: true,
      title: job.title,
      url: job.url,
      saveResponses: true,
      requestMethod: 0, // GET
      requestTimeout: 300,
      schedule: job.schedule,
      extendedData: {
        headers: {
          Authorization: `Bearer ${CRON_SECRET}`,
        },
      },
      notification: {
        onFailure: true,
        onFailureCount: 3,
        onSuccess: false,
        onDisable: true,
      },
    },
  };

  const res = await fetch(`${CRONJOB_API}/jobs`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to create ${job.title}: ${res.status} ${err}`);
  }

  const data = await res.json() as { jobId: number };
  return data.jobId;
}

async function listExisting(): Promise<Array<{ jobId: number; title: string }>> {
  const res = await fetch(`${CRONJOB_API}/jobs`, { headers });
  if (!res.ok) throw new Error(`Failed to list jobs: ${res.status}`);
  const data = await res.json() as { jobs: Array<{ jobId: number; title: string }> };
  return data.jobs;
}

async function main() {
  console.log('Checking existing cron-job.org jobs...');
  const existing = await listExisting();
  const existingTitles = existing.map((j) => j.title);

  for (const job of JOBS) {
    if (existingTitles.includes(job.title)) {
      const match = existing.find((j) => j.title === job.title);
      console.log(`  SKIP  ${job.title} (already exists, jobId: ${match?.jobId})`);
      continue;
    }

    const jobId = await createJob(job);
    console.log(`  CREATE ${job.title} → jobId: ${jobId} | ${job.url}`);
  }

  console.log('\nDone. Verify at: https://console.cron-job.org');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
