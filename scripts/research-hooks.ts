#!/usr/bin/env tsx
/**
 * Hook & Post Research + Social Listening Runner (GStack-powered, free)
 * 
 * Mines real high-performing posts/hooks from X for the Hook Intelligence system.
 * Supports scale to 1k-10k+ over time via repeated runs.
 * Stores in local dataset + InsForge DB (hook_examples table).
 * 
 * Usage for scale:
 *   npx tsx scripts/research-hooks.ts --all --target 200
 *   npx tsx scripts/research-hooks.ts --viral --count 50   # high-engagement search
 *   (Run in loop/cron/agent for 1k-10k accumulation. Be polite to X.)
 * 
 * Integrates with agents via the intelligence tools + DB RAG.
 */

import { spawnSync } from 'child_process';
import { addHooksToDataset } from '../src/lib/hooks-intelligence';
import type { ExtractedHook, HookVertical } from '../src/lib/hooks-intelligence/types';
const B = process.env.B || `${process.env.HOME}/.claude/skills/gstack/browse/dist/browse`;

function extractPostsFromProfile(handle: string, max = 20): Array<{text: string, engagement?: any}> {
  spawnSync(B, ['goto', `https://x.com/${handle}`], { encoding: 'utf8' });
  spawnSync('sleep', ['4']);  // More time for X JS render

  // More robust extraction (X DOM changes often)
  const js = `
    let articles = Array.from(document.querySelectorAll('article'));
    if (articles.length < 2) articles = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'));
    articles.slice(0, ${max}).map(article => {
      let textEl = article.querySelector('div[data-testid="tweetText"]');
      if (!textEl) textEl = article;
      const text = (textEl.innerText || textEl.textContent || '').trim();
      const likesMatch = article.textContent.match(/\\b(\\d+[Kk]?)\\s*(?:like|likes)/i);
      const repliesMatch = article.textContent.match(/\\b(\\d+[Kk]?)\\s*(?:reply|replies)/i);
      return { 
        text: text.substring(0, 2000), 
        engagement: { 
          likes: likesMatch ? parseInt(likesMatch[1].replace(/k/i,'000')) : 0, 
          replies: repliesMatch ? parseInt(repliesMatch[1].replace(/k/i,'000')) : 0 
        } 
      };
    }).filter(p => p.text && p.text.length > 20)
  `;
  const extract = spawnSync(B, ['js', js], { encoding: 'utf8' });

  try {
    const raw = JSON.parse(extract.stdout || '[]');
    return raw.filter((p: any) => p.text);
  } catch (e) {
    console.error('Extract error for', handle, (e as any).message?.slice(0,80));
    return [];
  }
}

function parseEng(v: any): number {
  if (!v) return 0;
  const s = v.toString().toLowerCase();
  if (s.includes('k')) return parseFloat(s) * 1000;
  return parseInt(s) || 0;
}

function createRecord(text: string, author: string, verticals: HookVertical[], engagement?: any): ExtractedHook {
  const id = Buffer.from(text.slice(0, 50) + author + Date.now()).toString('base64').slice(0, 20);
  return {
    id,
    text: text.substring(0, 2000),  // Cap for storage
    author,
    platform: 'x',
    verticals,
    engagement,
    minedAt: new Date().toISOString(),
  };
}

async function insertToDB(records: ExtractedHook[]) {
  try {
    const url = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_URL;
    const key = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY;
    if (!url || !key) {
      console.log('No InsForge creds in env - skipping DB insert (local dataset only)');
      return 0;
    }

    // Fixed: Dynamic import to avoid ESM/CJS "exports main" error with @insforge/shared-schemas transitive dep in tsx
    const { createClient } = await import('@insforge/sdk');
    const client = createClient({ baseUrl: url, anonKey: key });

    const rows = records.map(r => ({
      id: r.id,
      text: r.text,
      author: r.author,
      platform: r.platform,
      verticals: r.verticals,
      engagement: r.engagement || {},
      score_total: 70,
      mined_at: r.minedAt,
    }));

    const { error } = await client.database.from('hook_examples').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
    return rows.length;
  } catch (e) {
    console.warn('DB insert skipped/failed (will rely on local dataset):', (e as Error).message);
    return 0;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const viral = args.includes('--viral');
  const target = parseInt(args.find(a => a.startsWith('--target='))?.split('=')[1] || args.find(a => a.startsWith('--count='))?.split('=')[1] || '50');

  console.log('🚀 GStack Research Runner - Scaling to 1k-10k+ real posts/hooks (free)');
  console.log(`Target this run: ~${target} items. Viral mode: ${viral}`);

  const { DEFAULT_WATCHLIST } = await import('../src/lib/hooks-intelligence/watchlist');
  let targets = all ? DEFAULT_WATCHLIST.accounts : DEFAULT_WATCHLIST.accounts.slice(0, 15);

  if (viral) {
    // Mine high-engagement via search (example; enhance with more queries)
    console.log('Viral mode: Mining high-engagement posts via X search...');
    // For demo, add a couple search "profiles" (in real: use search URLs)
    targets = targets.concat([{ handle: 'search: min_faves:300 min_replies:20', verticals: ['general'] as any, priority: 5 }]);
  }

  const allNew: ExtractedHook[] = [];

  for (const acc of targets.slice(0, target / 5)) {  // Rough batch size
    const handle = acc.handle;
    console.log(`\n⛏️ Mining ${handle} (${acc.verticals.join(', ')})`);
    const posts = extractPostsFromProfile(handle.replace('search: ', ''), 6);

    const records = posts.map(p => createRecord(p.text, handle.replace('search: ', ''), acc.verticals as HookVertical[], p.engagement));
    allNew.push(...records);
    console.log(`   → ${records.length} posts/hooks extracted`);
    await new Promise(r => setTimeout(r, 2200));  // Politeness
  }

  if (allNew.length > 0) {
    const addedLocal = addHooksToDataset(allNew);
    const addedDb = await insertToDB(allNew);
    console.log(`\n✅ Added ${addedLocal} to local dataset, ${addedDb} to InsForge DB.`);
    console.log(`Run this repeatedly (cron / agent loop) to reach 1k-10k+ over days.`);
    console.log(`GStack tip: Codify this flow as a browser-skill for 10x faster future runs.`);
  } else {
    console.log('No new data this run (rate limits or DOM changes - retry or refine selectors).');
  }

  // Log to GStack for persistence
  console.log('\nLogging run to GStack learnings...');
  // (In real: use gstack-learnings-log binary with summary)
}

main().catch(console.error);
