#!/usr/bin/env npx tsx
/**
 * Intelligence health + run tool - voice, hooks, social listening in one command.
 *
 * Usage:
 *   set -a && source .env.local && set +a && npm run intelligence:health
 *   npm run intelligence:health -- --url https://your-app.vercel.app --remote
 *   npm run intelligence:run
 */
import { buildIntelligenceHealthReport } from '../src/lib/intelligence/health';

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const runMode = args.includes('--run');
const urlIdx = args.indexOf('--url');
const baseUrl = urlIdx >= 0 ? args[urlIdx + 1] : process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

function log(msg: string) {
  if (!jsonOnly) console.log(msg);
}

async function fetchHealth(url: string): Promise<unknown> {
  const res = await fetch(`${url.replace(/\/$/, '')}/api/intelligence/health`, {
    signal: AbortSignal.timeout(20000),
  });
  return res.json();
}

async function runIntelligence(url: string): Promise<unknown> {
  const cron = process.env.CRON_SECRET?.trim();
  if (!cron) {
    throw new Error('CRON_SECRET missing - add to .env.local');
  }
  const res = await fetch(`${url.replace(/\/$/, '')}/api/intelligence/run`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cron}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mine: true, accounts: 20 }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main(): Promise<number> {
  let report: Awaited<ReturnType<typeof buildIntelligenceHealthReport>>;

  if (args.includes('--remote') || runMode) {
    log(`Probing ${baseUrl}/api/intelligence/health ...`);
    report = (await fetchHealth(baseUrl)) as typeof report;
  } else {
    report = await buildIntelligenceHealthReport();
  }

  if (runMode) {
    log(`Running social listening + mine @ ${baseUrl} ...`);
    const runResult = await runIntelligence(baseUrl);
    if (jsonOnly) {
      console.log(JSON.stringify({ health: report, run: runResult }, null, 2));
    } else {
      console.log(JSON.stringify(runResult, null, 2));
    }
  } else if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('\n=== Content OS Intelligence Health ===\n');
    console.log(`Overall: ${report.status.toUpperCase()}`);
    console.log(`Voice:           ${report.voice.status} - ${report.voice.message}`);
    console.log(`Hooks:           ${report.hooks.status} - ${report.hooks.message}`);
    console.log(`Social listening: ${report.socialListening.status} - ${report.socialListening.message}`);
    console.log(`Database:        ${report.database.status} - ${report.database.message}`);
    if (report.actions.length > 0) {
      console.log('\nRecommended actions:');
      for (const a of report.actions) console.log(`  • ${a}`);
    }
    console.log('');
  }

  return report.status === 'ok' ? 0 : report.status === 'degraded' ? 0 : 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
