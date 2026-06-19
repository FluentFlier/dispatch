/**
 * Bulk import the current viral hooks dataset into InsForge hook_examples table.
 * Run this with real InsForge service creds to get 1000+ into the real DB.
 * 
 * Usage: npx tsx scripts/bulk-import-hooks-to-db.ts
 */
import * as fs from 'fs';

async function main() {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_URL;
  const key = process.env.INSFORGE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!url || !key) {
    console.error("Missing InsForge creds. Set INSFORGE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_INSFORGE_URL) in .env");
    process.exit(1);
  }

  // Dynamic import avoids tsx/CJS resolution issues with @insforge/shared-schemas.
  const { createClient } = await import('@insforge/sdk');
  const client = createClient({ baseUrl: url, anonKey: key, isServerMode: true });

  const dataset = JSON.parse(fs.readFileSync('data/hooks-dataset.json', 'utf8'));
  const hooks = dataset.hooks || [];
  const analytics = dataset.analytics || [];

  console.log(`Importing ${hooks.length} hooks + ${analytics.length} analytics rows to InsForge...`);

  // 1) hook_examples — use the per-hook scores/details from the dataset
  //    (generated with the app's own scoreHook logic), not a flat default.
  const rows = hooks.map((h: any) => ({
    id: h.id,
    text: h.text,
    author: h.author,
    platform: h.platform || 'x',
    verticals: h.verticals || ['general'],
    engagement: h.engagement || {},
    score_total: typeof h.score_total === 'number' ? h.score_total : 75,
    score_details: h.score_details || { source: 'gstack-bulk-import' },
    performance_delta: h.performance_delta ?? 0,
    mined_at: h.mined_at || h.minedAt || new Date().toISOString(),
  }));

  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await client.database.from('hook_examples').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error("hook_examples batch error:", error);
    } else {
      console.log(`Upserted hook_examples batch ${i / batchSize + 1}`);
    }
  }

  // 2) analytics_snapshots — the "respective analytics" for the hooks
  //    (per-hook performance + 30-day aggregate time series). No stable unique
  //    key on this table, so insert rather than upsert.
  if (analytics.length > 0) {
    for (let i = 0; i < analytics.length; i += batchSize) {
      const batch = analytics.slice(i, i + batchSize);
      const { error } = await client.database.from('analytics_snapshots').insert(batch);
      if (error) {
        console.error("analytics_snapshots batch error:", error);
      } else {
        console.log(`Inserted analytics_snapshots batch ${i / batchSize + 1}`);
      }
    }
  }

  console.log("Done. Hooks + analytics now in the database for RAG / analytics.");
}

main().catch(console.error);
