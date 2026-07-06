#!/usr/bin/env npx tsx
/**
 * Regenerate landing visuals via Gemini or Hugging Face FLUX.
 *
 * Usage:
 *   set -a && source .env.local && set +a && npm run landing:assets
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeMarketingImage } from '../src/lib/image-gen';

const OUT = path.join(process.cwd(), 'public', 'landing');

const ASSETS = [
  {
    file: 'hero-bg.png',
    prompt:
      'Ultra-premium minimal SaaS hero background. Soft white silk fabric flowing in gentle waves, pale sky blue ambient light, clean Apple-style atmosphere. Off-white base. No text, no logos, no UI, no people.',
  },
  {
    file: 'glow.png',
    prompt:
      'Abstract soft gradient light orb, pale blue and warm white, minimal premium SaaS decoration. No text, no objects.',
  },
  {
    file: 'mesh.png',
    prompt:
      'Abstract luminous mesh gradient for website section divider. Soft white, pale blue and subtle teal light trails on off-white. Ethereal, smooth, premium tech brand. No text, no UI, no objects.',
  },
  {
    file: 'voice-texture.png',
    prompt:
      'Soft abstract paper texture with faint blue-teal light leak, minimal editorial photography background for SaaS website. Warm off-white. No text, no people.',
  },
] as const;

async function main() {
  await mkdir(OUT, { recursive: true });

  for (const asset of ASSETS) {
    const dest = path.join(OUT, asset.file);
    process.stdout.write(`Generating ${asset.file}… `);
    const provider = await writeMarketingImage(asset.prompt, dest);
    console.log(`done (${provider}) → ${dest}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
