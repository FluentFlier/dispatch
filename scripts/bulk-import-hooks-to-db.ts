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
    console.error("Missing InsForge creds. Set INS FORGE_SERVICE_ROLE_KEY or similar in .env");
    process.exit(1);
  }

  // Dynamic import avoids tsx/CJS resolution issues with @insforge/shared-schemas.
  const { createClient } = await import('@insforge/sdk');
  const client = createClient({ baseUrl: url, anonKey: key, isServerMode: true });

  const dataset = JSON.parse(fs.readFileSync('data/hooks-dataset.json', 'utf8'));
  const hooks = dataset.hooks || [];

  console.log(`Importing ${hooks.length} hooks to InsForge hook_examples...`);

  const rows = hooks.map((h: any) => ({
    id: h.id,
    text: h.text,
    author: h.author,
    platform: h.platform || 'x',
    verticals: h.verticals || ['general'],
    engagement: h.engagement || {},
    score_total: 75, // default until rescored
    score_details: { source: 'gstack-bulk-import' },
    mined_at: h.minedAt || new Date().toISOString(),
  }));

  // Batch upsert
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await client.database.from('hook_examples').upsert(batch, { onConflict: 'id' });
    if (error) {
      console.error("Batch error:", error);
    } else {
      console.log(`Upserted batch ${i / batchSize + 1}`);
    }
  }

  console.log("Done. Hooks now in the database for RAG / analytics.");
}

main().catch(console.error);
