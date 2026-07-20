#!/usr/bin/env tsx
/**
 * Server-side QA re-verification for F2 (hooks), F3 (caption+hashtags),
 * F4 (reply N->N) on the configured LLM (now Groq 70B).
 *
 * Why a replica instead of importing the real pipeline: voice-pipeline ->
 * hooks-intelligence -> retriever -> @insforge/sdk, and @insforge/shared-schemas
 * ships without an `exports` map, so Node/tsx ESM resolution throws outside
 * Next's bundler. The pipeline's fast:true path is, however, exactly:
 *   buildSystemPrompt(profile, composeHints) -> chatCompletion -> stripEmDashes
 * none of which touch the SDK. We replicate that path 1:1, inject the REAL
 * creator profile (pulled from the DB), and apply the SAME client-side parse
 * functions the generate components use. The ONLY deviation from production is
 * the 6 RAG hook examples the pipeline injects into the system prompt - omitted
 * here because that import pulls in the broken chain. That affects flavour, not
 * the F2/F3/F4 structural contracts under test.
 *
 * Usage: npx tsx --env-file=.env.local scripts/qa-verify-f2-f4.ts
 */

import { chatCompletion } from '../src/lib/llm';
import { buildSystemPrompt, type CreatorProfileForPrompt } from '../src/lib/ai';
import { buildVoiceComposeHints, type VoiceContentType } from '../src/lib/voice-prompts';
import { parseReplies } from '../src/lib/reply-parse';

// Real profile for the test creator (user 5618576d-...), fetched from creator_profile.
const PROFILE: CreatorProfileForPrompt = {
  display_name: 'Rudheer Reddy',
  bio: 'I am a rising senior at ASU building and shipping AI native Products and also a car guy and an occasional photographer',
  bio_facts: 'I am a rising senior at ASU building and shipping AI native Products and also a car guy and an occasional photographer',
  content_pillars: [
    { name: 'Artificial Intelligence', description: 'The world of artificial intelligence' },
    { name: 'Arizona State University', description: 'About arizona state university' },
    { name: 'Software Developer', description: 'This covers about the software development' },
  ],
  voice_description: 'Direct, simple, a tiny bit humorous, informative, relatable',
  voice_rules: 'No emojis, no em dashes (--), and do not sound like AI',
};

/** Replicates voice-pipeline.ts fast-path (em-dash strip + single draft). */
function stripEmDashes(text: string): string {
  return text.replace(/\u2014/g, ' - ').replace(/\u2013/g, '-');
}
async function fastGenerate(userPrompt: string, contentType: VoiceContentType): Promise<string> {
  const composeHints = buildVoiceComposeHints(undefined, contentType);
  const systemPrompt = buildSystemPrompt(PROFILE, composeHints || undefined);
  return stripEmDashes(await chatCompletion(systemPrompt, userPrompt));
}

// --- Parse functions copied verbatim from the generate components ---

/** From HookGenerator.tsx. */
function parseHooks(text: string): string[] {
  const trimFirstSentence = (s: string): string => {
    const cuts = ['. ', '! ', '? '].map((p) => s.indexOf(p)).filter((i) => i > 20);
    const cutAt = cuts.length > 0 ? Math.min(...cuts) + 1 : -1;
    return (cutAt > 0 ? s.slice(0, cutAt) : s.slice(0, 200)).trim();
  };
  const numbered = text
    .split('\n').map((l) => l.trim())
    .filter((l) => /^\d+[.)]/.test(l))
    .map((l) => trimFirstSentence(l.replace(/^\d+[.)]\s*/, '')))
    .filter((l) => l.length > 5);
  if (numbered.length > 1) return numbered;
  const lines = text
    .split('\n').map((l) => l.trim())
    .filter((l) => l.length > 5).map(trimFirstSentence);
  if (lines.length > 1) return lines;
  const sentences = text
    .split(/(?<=[.!?])\s+/).map((s) => s.trim())
    .filter((s) => s.length > 10);
  return sentences.length > 1 ? sentences : [text.trim()];
}

/** From CaptionHashtags.tsx. */
function extractHashtags(output: string): string {
  const tags = output.match(/#[A-Za-z0-9_]+/g);
  return tags ? tags.join(' ') : '';
}

// --- Harness ---
interface Check { id: string; name: string; pass: boolean; detail: string; }
const checks: Check[] = [];
function record(c: Check) {
  checks.push(c);
  console.log(`\n[${c.pass ? 'PASS' : 'FAIL'}] ${c.id} - ${c.name}\n       ${c.detail}`);
}

async function main() {
  console.log(`LLM_MODEL=${process.env.LLM_MODEL}  BASE=${process.env.LLM_BASE_URL}\n`);

  // --- F2: hooks (expect ~8 distinct hooks, not one paragraph) ---
  {
    const prompt = `Generate 8 Instagram hooks for: the creator's main content topics.
One sentence each. First word must stop the scroll.
Mix styles:
- Stat-based: use a real number or achievement from the creator's context
- Contrarian: challenge a common assumption in the creator's space
- Story-drop: drop into a specific moment from the creator's experience
- Challenge: call out something the audience is doing wrong
- Curiosity: tease something surprising the creator has learned
- Vulnerability: share a real struggle or near-failure
Numbered 1-8. One per line. No explanation. No em dashes.`;
    const text = await fastGenerate(prompt, 'hooks');
    const hooks = parseHooks(text);
    const distinct = new Set(hooks.map((h) => h.toLowerCase())).size;
    console.log('--- F2 raw ---\n' + text + '\n--------------');
    record({ id: 'F2', name: 'Hooks: multiple distinct (not 1 paragraph)',
      pass: hooks.length >= 6 && distinct >= 6,
      detail: `${hooks.length} hooks, ${distinct} distinct (want >=6 each).` });
  }

  // --- F3: caption + hashtags (expect caption text AND >=15 hashtags) ---
  {
    const script = 'A 30-second reel on why most early-stage founders waste their first 90 days building features no one asked for, and what to do instead.';
    const prompt = `Write an Instagram caption and hashtag set.
VIDEO: ${script}
CAPTION: 2-4 sentences. First line is the hook shown before "more". Raw, honest, the creator's voice. No em dashes. Direct question at the end to drive comments.
HASHTAGS: 20-25 hashtags. Mix niche topics relevant to the creator's content pillars, personal brand, and broad reach. One line, space-separated.
No labels. Just caption, blank line, hashtags.`;
    const text = await fastGenerate(prompt, 'caption');
    const tags = extractHashtags(text);
    const tagCount = tags ? tags.split(' ').filter(Boolean).length : 0;
    const captionBody = text.replace(/#[A-Za-z0-9_]+/g, '').trim();
    console.log('--- F3 raw ---\n' + text + '\n--------------');
    record({ id: 'F3', name: 'Caption: caption body AND hashtag block',
      pass: tagCount >= 15 && captionBody.length > 40,
      detail: `${tagCount} hashtags (want >=15), caption body ${captionBody.length} chars (want >40).` });
  }

  // --- F4: reply N->N (3 comments in -> exactly 3 replies, none empty) ---
  {
    const commentLines = [
      'This is exactly what I needed to hear today, thank you!',
      'Hard disagree. Shipping fast beats overthinking every time.',
      'How do you decide what to build first when everything feels urgent?',
    ];
    const prompt = `Write one reply per comment below, in the creator's voice (use their voice from your system context), not a generic brand account.

PLATFORM: Instagram comment. Short, conversational. No em dashes.

COMMENTS (reply to each, in order):
${commentLines.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY a JSON array of strings - exactly one reply per comment, in the same order. Example: ["first reply", "second reply"]. No other text, no markdown.`;
    const text = await fastGenerate(prompt, 'reply');
    const replies = parseReplies(text, commentLines);
    const empties = replies.filter((r) => r.reply === '(no reply generated)').length;
    console.log('--- F4 raw ---\n' + text + '\n--------------');
    replies.forEach((r, i) => console.log(`  [${i + 1}] ${r.comment}\n      -> ${r.reply}`));
    record({ id: 'F4', name: 'Reply: exactly one per comment (N->N), none empty',
      pass: replies.length === commentLines.length && empties === 0,
      detail: `${commentLines.length} -> ${replies.length} replies, ${empties} empty (want 3->3, 0 empty).` });
  }

  console.log('\n========== SUMMARY ==========');
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id}  ${c.name}`);
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(2); });
