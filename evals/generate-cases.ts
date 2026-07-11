/**
 * Emits the golden dataset deterministically (seeded PRNG - same output every
 * run, dataset changes only via reviewed edits to this file).
 *   npx tsx evals/generate-cases.ts
 * Writes: fixtures/profiles/*.json, cases/core/generated.yaml, cases/holdout/holdout.yaml
 *
 * Sizing per spec: start ~150 total (120 core + 30 holdout [20%]), grow only
 * when new production failure categories appear.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = __dirname;

// ---------- 12 niche profiles (voice_rules 2-3 lines each, distinct voices) ----------
const PROFILES = [
  { file: 'automotive.json', display_name: 'Marco Diaz', niche: 'automotive detailing',
    voice_description: 'Blunt shop owner. Numbers first, zero fluff, dry humor.',
    voice_rules: 'Open with a cost or time number when possible.\nShort declarative sentences. No exclamation marks.' },
  { file: 'fitness.json', display_name: 'Dana Cole', niche: 'strength coaching for busy parents',
    voice_description: 'Warm but no-nonsense coach. Talks to one reader.',
    voice_rules: 'Address the reader as "you".\nOne concrete workout or meal example per post.' },
  { file: 'technews.json', display_name: 'Priya Raman', niche: 'AI and chip industry analysis',
    voice_description: 'Analyst voice. Claims backed by a source or number, mild skepticism.',
    voice_rules: 'Never hype. Flag uncertainty explicitly.\nEnd with an implication, not a summary.' },
  { file: 'entrepreneurship.json', display_name: 'Sam Okafor', niche: 'bootstrapped SaaS',
    voice_description: 'Builder-in-public. Revenue numbers, failures included.',
    voice_rules: 'Share real numbers including bad ones.\nSelf-deprecating, never preachy.' },
  { file: 'career.json', display_name: 'Elena Petrov', niche: 'career coaching for engineers',
    voice_description: 'Direct mentor. Scripts and exact phrasing over platitudes.',
    voice_rules: 'Give exact words to say in conversations.\nCall out bad common advice by name.' },
  { file: 'finance.json', display_name: 'Rob Tanaka', niche: 'personal finance for freelancers',
    voice_description: 'Calm educator. Compliance-aware, never promises returns.',
    voice_rules: 'Always name the caveat.\nUse round illustrative numbers labeled as examples.' },
  { file: 'marketing.json', display_name: 'Ines Beltran', niche: 'B2B demand gen',
    voice_description: 'Punchy operator. Teardown style, screenshots-described.',
    voice_rules: 'Structure as: observation, why it works, how to copy it.' },
  { file: 'devtools.json', display_name: 'Karl Jensen', niche: 'developer tools',
    voice_description: 'Engineer writing for engineers. Precise, examples over adjectives.',
    voice_rules: 'Include one concrete code-adjacent detail per post.\nNever say revolutionary.' },
  { file: 'ecommerce.json', display_name: 'Fatima Noor', niche: 'DTC ecommerce operations',
    voice_description: 'Ops-brain founder. Margins, logistics, unglamorous wins.',
    voice_rules: 'Anchor every claim in an operational metric.\nPlain words, no retail jargon.' },
  { file: 'realestate.json', display_name: 'Greg Malone', niche: 'commercial real estate',
    voice_description: 'Old-school dealmaker. Stories from closings, long horizons.',
    voice_rules: 'One deal story per post with the lesson at the end.' },
  { file: 'design.json', display_name: 'Yuki Sato', niche: 'product design leadership',
    voice_description: 'Quiet authority. Questions assumptions, hates trends.',
    voice_rules: 'Open with a question or a contrarian observation.\nNo listicles.' },
  // Pathological fixture: voice_rules that FIGHT the paragraph floor - the
  // platform floor must win (spec: no per-creator rule may degrade every post).
  { file: 'pathological-staccato.json', display_name: 'Vic Sharp', niche: 'sales motivation',
    voice_description: 'Hype sales trainer.',
    voice_rules: 'Write short one or two-sentence paragraphs.\nEvery line punches. Line breaks between every sentence.' },
];

// ---------- prompt archetypes x platforms ----------
const ARCHETYPES: Array<{ tag: string; prompt: (niche: string) => string; sourceContext?: string; mentions?: string[] }> = [
  { tag: 'story', prompt: (n) => `Write about a recent client/customer situation in ${n} and the lesson. Context: client paid for the premium option, almost churned over a misunderstanding about scope, stayed after one honest phone call.` },
  { tag: 'howto', prompt: (n) => `Write a how-to post sharing a repeatable process in ${n}. Context: the process has 4 steps and saves roughly 3 hours a week; we have used it for 6 months.` },
  { tag: 'hot-take', prompt: (n) => `Write a contrarian opinion post about a common practice in ${n} that you think is wrong, argued from experience, no invented statistics.` },
  { tag: 'news-react', prompt: (n) => `React to an industry shift affecting ${n}. Context: a major platform changed its pricing last week; our costs rose 18%; we are switching one workflow in response.` },
  { tag: 'launch', prompt: (n) => `Announce a new offer in ${n} without sounding like an ad. Context: new service tier at $450/month, 5 beta customers, waitlist opens Friday.` },
];
const PLATFORMS = ['linkedin', 'twitter'] as const;

// ---------- deterministic PRNG (mulberry32, seed fixed) ----------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260711);

interface CaseDef {
  description: string;
  vars: Record<string, unknown>;
}

function makeCase(profileFile: string | null, niche: string, arch: (typeof ARCHETYPES)[number], platform: string, useVoice: boolean): CaseDef {
  const userPrompt = arch.prompt(niche);
  const inner: Record<string, unknown> = { userPrompt, platform, contentType: 'post', useVoice };
  if (profileFile && useVoice) inner.profileFixture = profileFile;
  if (arch.sourceContext) inner.sourceContext = arch.sourceContext;
  if (arch.mentions) inner.mentions = arch.mentions;
  const vars: Record<string, unknown> = { caseJson: JSON.stringify(inner), userPrompt, platform, contentType: 'post' };
  if (arch.sourceContext) vars.sourceContext = arch.sourceContext;
  if (arch.mentions) vars.mentions = arch.mentions;
  return {
    description: `core/${arch.tag}/${platform}/${useVoice ? 'voice' : 'novoice'}/${niche.split(' ')[0]}`,
    vars,
  };
}

// ---------- emit ----------
mkdirSync(join(root, 'fixtures', 'profiles'), { recursive: true });
mkdirSync(join(root, 'cases', 'core'), { recursive: true });
mkdirSync(join(root, 'cases', 'holdout'), { recursive: true });

for (const p of PROFILES) {
  const { file, ...rest } = p;
  writeFileSync(join(root, 'fixtures', 'profiles', file), JSON.stringify({
    profile: { display_name: rest.display_name, voice_description: rest.voice_description, voice_rules: rest.voice_rules, content_pillars: [rest.niche] },
  }, null, 2));
}

const cases: CaseDef[] = [];
for (const p of PROFILES) {
  for (const arch of ARCHETYPES) {
    for (const platform of PLATFORMS) {
      // voice-on for every combo; voice-off sampled at ~25% to control cost
      cases.push(makeCase(p.file, p.niche, arch, platform, true));
      if (rand() < 0.25) cases.push(makeCase(null, p.niche, arch, platform, false));
    }
  }
}

// 20% holdout, deterministic shuffle
const shuffled = [...cases].sort(() => rand() - 0.5);
const holdoutN = Math.floor(shuffled.length * 0.2);
const holdout = shuffled.slice(0, holdoutN).map((c) => ({ ...c, description: c.description.replace('core/', 'holdout/') }));
const core = shuffled.slice(holdoutN);

const toYaml = (defs: CaseDef[]) =>
  defs.map((c) => `- description: ${JSON.stringify(c.description)}\n  vars:\n${Object.entries(c.vars)
    .map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join('\n')}`).join('\n');

writeFileSync(join(root, 'cases', 'core', 'generated.yaml'), toYaml(core) + '\n');
writeFileSync(join(root, 'cases', 'holdout', 'holdout.yaml'), toYaml(holdout) + '\n');
console.log(`profiles: ${PROFILES.length}, core: ${core.length}, holdout: ${holdout.length}`);
