#!/usr/bin/env tsx
/**
 * Directory-scrape debug runner.
 *
 * Exercises the live TinyFish directory-scrape path in isolation — no UI, no DB,
 * no Next.js. Prints the raw run outcome and the normalized IngestedLead rows so
 * a scrape failure is visible and reproducible from the terminal.
 *
 * Usage:
 *   npx tsx scripts/signals-scrape-debug.ts                 # yc_directory (default)
 *   npx tsx scripts/signals-scrape-debug.ts product_hunt    # a specific source
 *   npx tsx scripts/signals-scrape-debug.ts yc_directory --raw   # raw Agent endpoint response
 *
 * Reads TINYFISH_API_KEY from .env.local. With no key, the seed fallback runs
 * (proves the downstream pipeline without spending an agent run).
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// --- Load .env.local into process.env (tsx does not auto-load it) ---
function loadEnvLocal(): void {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch {
    console.warn('[debug] no .env.local found — running with process env only');
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  process.env.SIGNALS_DEBUG = process.env.SIGNALS_DEBUG ?? 'true';

  const args = process.argv.slice(2);
  const raw = args.includes('--raw');
  const source = (args.find((a) => !a.startsWith('--')) ?? 'yc_directory') as
    | 'yc_directory'
    | 'yc_launches'
    | 'product_hunt';

  const keySet = Boolean(process.env.TINYFISH_API_KEY?.trim());
  console.log(`\n=== signals-scrape-debug ===`);
  console.log(`source: ${source}`);
  console.log(`TINYFISH_API_KEY: ${keySet ? 'SET (live scrape)' : 'UNSET (seed fallback)'}\n`);

  // Dynamic imports so the modules read process.env AFTER we populate it.
  const { DIRECTORY_QUERIES, LEAD_OUTPUT_SCHEMA, renderGoal } = await import(
    '../src/lib/signals/ingest/directory-queries'
  );

  if (raw && keySet) {
    const config = DIRECTORY_QUERIES[source];
    if (!config) throw new Error(`No config for ${source}`);
    console.log('--- raw TinyFish Agent /run ---');
    const started = Date.now();
    const res = await fetch('https://agent.tinyfish.ai/v1/automation/run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.TINYFISH_API_KEY!.trim(),
      },
      body: JSON.stringify({
        url: config.url,
        goal: renderGoal(config),
        output_schema: LEAD_OUTPUT_SCHEMA,
      }),
    });
    console.log(`HTTP ${res.status} ${res.statusText} in ${Date.now() - started}ms`);
    console.log((await res.text()).slice(0, 4000));
    return;
  }

  const { fetchDirectoryLeads, isTinyFishConfigured } = await import(
    '../src/lib/signals/ingest/tinyfish-fetch'
  );
  console.log(`isTinyFishConfigured(): ${isTinyFishConfigured()}\n`);

  const started = Date.now();
  try {
    const leads = await fetchDirectoryLeads(source);
    console.log(`\n✅ ${leads.length} leads in ${Date.now() - started}ms\n`);
    console.log(JSON.stringify(leads.slice(0, 3), null, 2));
    if (leads.length > 3) console.log(`... and ${leads.length - 3} more`);
  } catch (err) {
    console.error(`\n❌ scrape threw after ${Date.now() - started}ms:`);
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
    if (err && typeof err === 'object' && 'cause' in err && err.cause) {
      const cause = (err as { cause: unknown }).cause;
      console.error('cause:', cause instanceof Error ? cause.message : String(cause));
    }
    process.exitCode = 1;
  }
}

void main();
