/**
 * Brain + semantic-memory wiring guarantees (docs/PIPELINE_WIRING_AUDIT.md).
 *   - break 8 : retrieveBrainContext reads vocabulary_fingerprint +
 *               structural_patterns back out of the voice page (not just
 *               voice_description / voice_rules) so the stored fingerprint is live
 *   - break 7 : searchUserContext resolves the workspace_${ws} container tag when
 *               a workspaceId is supplied (matches the write tag)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BRAIN_SLUG } from '@/lib/brain/types';

const getBrainPage = vi.fn();
const listBrainPages = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/brain/pages', () => ({
  getBrainPage: (...a: unknown[]) => getBrainPage(...a),
  listBrainPages: (...a: unknown[]) => listBrainPages(...a),
}));

import { retrieveBrainContext } from '@/lib/brain/retrieve';
import { searchUserContext } from '@/lib/supermemory';

beforeEach(() => {
  getBrainPage.mockReset();
  listBrainPages.mockReset().mockResolvedValue([]);
});

describe('brain retrieve reads the fingerprint (break 8)', () => {
  it('surfaces vocabulary_fingerprint + structural_patterns from the voice page', async () => {
    const voiceBody = JSON.stringify({
      voice_description: 'punchy founder',
      voice_rules: 'no em dashes',
      vocabulary_fingerprint: { uses_often: ['shipped', 'honestly'], signature_phrases: ['here is the thing'] },
      structural_patterns: { hook_pattern: 'open with a blunt claim', closing_pattern: 'one-line kicker' },
    });
    getBrainPage.mockImplementation(async (_c: unknown, _u: unknown, slug: string) =>
      slug === BRAIN_SLUG.voice ? { body: voiceBody } : null,
    );

    const snippets = await retrieveBrainContext({} as never, 'user-1', undefined, 'ws-1');
    const joined = snippets.join('\n');

    expect(joined).toContain('punchy founder');           // still reads description
    expect(joined).toContain('shipped, honestly');        // fingerprint now read back
    expect(joined).toContain('here is the thing');        // signature phrases
    expect(joined).toContain('open with a blunt claim');  // structural hook pattern
    expect(joined).toContain('one-line kicker');          // structural closing pattern
  });
});

describe('searchUserContext container tag (break 7)', () => {
  const realFetch = global.fetch;
  beforeEach(() => vi.stubEnv('SUPERMEMORY_API_KEY', 'test-key'));
  afterEach(() => { global.fetch = realFetch; vi.unstubAllEnvs(); });

  it('resolves workspace_${ws} when a workspaceId is passed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '',
    });
    global.fetch = fetchMock as never;

    await searchUserContext('user-1', 'launch recap', 5, 'ws-42');

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.containerTags).toEqual(['workspace_ws-42']);
  });

  it('falls back to user_${id} when no workspaceId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ results: [] }), text: async () => '',
    });
    global.fetch = fetchMock as never;

    await searchUserContext('user-1', 'launch recap', 5);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.containerTags).toEqual(['user_user-1']);
  });
});
