import { describe, it, expect, vi } from 'vitest';
import { verifyOnboardingBrain } from '@/lib/brain/verify';

function mockClient(opts: {
  voiceBody?: Record<string, unknown>;
  profileBody?: Record<string, unknown>;
  settings?: Array<{ key: string; value: string }>;
  pageCount?: number;
}) {
  const voiceBody = JSON.stringify(
    opts.voiceBody ?? {
      voice_description: 'Writes in short punchy sentences with builder energy.',
      voice_rules: 'DO: be direct\nNEVER: use jargon',
    },
  );
  const profileBody = JSON.stringify(
    opts.profileBody ?? {
      display_name: 'Alex',
      content_pillars: [{ name: 'Insights' }],
    },
  );

  return {
    database: {
      from: (table: string) => {
        if (table === 'creator_brain_pages') {
          const chain = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            maybeSingle: async () => {
              const slug = (chain as { _slug?: string })._slug;
              if (slug === 'voice') {
                return { data: { body: voiceBody }, error: null };
              }
              if (slug === 'profile') {
                return { data: { body: profileBody }, error: null };
              }
              return { data: null, error: null };
            },
          };
          (chain as { _slug?: string })._slug = undefined;
          const origEq = chain.eq;
          chain.eq = function eq(field: string, value: string) {
            if (field === 'slug') (chain as { _slug?: string })._slug = value;
            return origEq.call(this, field, value);
          };
          return chain;
        }

        if (table === 'user_settings') {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({
                  data: opts.settings ?? [
                    { key: 'vocabulary_fingerprint', value: '{}' },
                    { key: 'structural_patterns', value: '{}' },
                    { key: 'persona_prompt_export', value: 'prompt' },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }

        throw new Error(`unexpected table ${table}`);
      },
    },
  };
}

vi.mock('@/lib/brain/pages', () => ({
  getBrainPage: vi.fn(async (_client, _userId, slug: string) => ({
    slug,
    body:
      slug === 'voice'
        ? JSON.stringify({
            voice_description: 'Writes in short punchy sentences with builder energy.',
            voice_rules: 'DO: be direct\nNEVER: use jargon',
          })
        : JSON.stringify({
            display_name: 'Alex',
            content_pillars: [{ name: 'Insights' }],
          }),
  })),
  listBrainPages: vi.fn(async () => [
    { slug: 'voice' },
    { slug: 'profile' },
    { slug: 'wins' },
    { slug: 'gtm' },
  ]),
}));

describe('verifyOnboardingBrain', () => {
  it('passes when voice, profile, specs, and brain pages are present', async () => {
    const client = mockClient({});
    const result = await verifyOnboardingBrain(client as never, 'user-1', 'ws-1');

    expect(result.ok).toBe(true);
    expect(result.voiceSynced).toBe(true);
    expect(result.profileSynced).toBe(true);
    expect(result.specsSynced).toBe(true);
    expect(result.brainProvisioned).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('fails when voice page is still pending', async () => {
    const { getBrainPage } = await import('@/lib/brain/pages');
    vi.mocked(getBrainPage).mockResolvedValueOnce({
      slug: 'voice',
      body: JSON.stringify({ status: 'pending' }),
    } as never);

    const client = mockClient({
      settings: [{ key: 'vocabulary_fingerprint', value: '{}' }],
    });
    const result = await verifyOnboardingBrain(client as never, 'user-1');

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('voice');
  });
});
