/**
 * Scope + JSON-parser wiring guarantees (audit breaks 22, 23).
 *   - break 22 : brain/save writes the saved-references page WITH the active
 *                workspaceId, matching the workspace-scoped read
 *   - break 23 : research fact extraction uses the shared hardened parseLlmJson
 *                (tolerant of fences + trailing prose), not a naive regex
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- break 23: parseResearchFactsJson robustness (standardized on parseLlmJson) ---
import { parseResearchFactsJson } from '@/lib/event-capture/extract';

describe('research fact JSON parsing (break 23)', () => {
  it('parses JSON wrapped in a markdown fence + trailing prose', () => {
    const raw = 'Here you go:\n```json\n{"summary":"a talk","speakers":[{"name":"Ada"}],"key_topics":["ai"],"key_announcements":[]}\n```\nHope that helps!';
    const facts = parseResearchFactsJson(raw);
    expect(facts).not.toBeNull();
    expect(facts?.summary).toBe('a talk');
    expect(facts?.speakers[0].name).toBe('Ada');
    expect(facts?.key_topics).toEqual(['ai']);
  });

  it('returns null (no throw) on unparseable output so the caller can fall back', () => {
    expect(parseResearchFactsJson('sorry, I could not extract anything')).toBeNull();
    expect(parseResearchFactsJson('{ broken json,,,')).toBeNull();
  });
});

// --- break 22: brain/save workspace scoping ---
const getAuthenticatedUser = vi.fn();
const getServerClient = vi.fn().mockReturnValue({});
vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: () => getAuthenticatedUser(),
  getServerClient: () => getServerClient(),
}));
const getActiveWorkspaceId = vi.fn();
vi.mock('@/lib/workspace', () => ({ getActiveWorkspaceId: () => getActiveWorkspaceId() }));
const getBrainPage = vi.fn();
const putBrainPage = vi.fn();
vi.mock('@/lib/brain/pages', () => ({
  getBrainPage: (...a: unknown[]) => getBrainPage(...a),
  putBrainPage: (...a: unknown[]) => putBrainPage(...a),
}));

import { POST as brainSavePOST } from '@/app/api/brain/save/route';

beforeEach(() => {
  getAuthenticatedUser.mockReset().mockResolvedValue({ id: 'user-1' });
  getActiveWorkspaceId.mockReset().mockResolvedValue('ws-42');
  getBrainPage.mockReset().mockResolvedValue(null);
  putBrainPage.mockReset().mockResolvedValue(undefined);
});

describe('brain/save workspace scope (break 22)', () => {
  it('reads and writes the saved-references page with the active workspaceId', async () => {
    const request = new Request('http://localhost/api/brain/save', {
      method: 'POST',
      body: JSON.stringify({ content: 'a great hook', source: 'analytics' }),
    });

    const res = await brainSavePOST(request);
    expect(res.status).toBe(200);

    // Read scoped to workspace (4th arg).
    expect(getBrainPage).toHaveBeenCalledWith(expect.anything(), 'user-1', expect.any(String), 'ws-42');
    // Write carries workspaceId so it lands where the read looks.
    const putArg = putBrainPage.mock.calls[0][2] as { workspaceId?: string };
    expect(putArg.workspaceId).toBe('ws-42');
  });
});
