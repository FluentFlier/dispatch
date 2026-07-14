import { describe, it, expect, vi, beforeEach } from 'vitest';
import { categorizeEngager } from '@/lib/hooks-intelligence/categorize';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { reactionsCacheKey, SOCIAL_GRAPH_CACHE_TTL_SECONDS } from '@/lib/social-graph/read-cache';

vi.mock('@/lib/signals/safety/guard', () => ({
  assertOutreachAllowed: vi.fn(),
}));

vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
  getLinkedInUnipileAccountId: vi.fn(),
  resolveLinkedInProfile: vi.fn(),
  sendLinkedInConnectionInvite: vi.fn(),
}));

vi.mock('@/lib/signals/safety/audit', () => ({
  logSignalAudit: vi.fn(),
}));

import { assertOutreachAllowed } from '@/lib/signals/safety/guard';
import {
  getLinkedInUnipileAccountId,
  sendLinkedInConnectionInvite,
} from '@/lib/signals/outreach/unipile-linkedin';
import { sendWarmContactConnect } from '@/lib/social-graph/outreach';

describe('Phase: Social graph (UseSocial integration)', () => {
  it('categorizes founder reactors as ICP', () => {
    expect(
      categorizeEngager({
        name: 'Jane Doe',
        handle: 'janedoe',
        bio: 'CEO at Acme',
        engagementType: 'like',
      }),
    ).toBe('ICP');
  });

  it('scores ICP with directory keywords', () => {
    expect(
      categorizeEngager(
        {
          name: 'Alex',
          handle: 'alex',
          bio: 'Head of growth at SaaS startup',
          engagementType: 'like',
        },
        ['saas', 'growth'],
      ),
    ).toBe('ICP');
  });

  it('builds stable reaction cache keys', () => {
    const a = reactionsCacheKey('user-1', 'post-abc', 'linkedin');
    const b = reactionsCacheKey('user-1', 'post-abc', 'linkedin');
    const c = reactionsCacheKey('user-1', 'post-xyz', 'linkedin');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('uses 15 minute cache TTL like UseSocial', () => {
    expect(SOCIAL_GRAPH_CACHE_TTL_SECONDS).toBe(900);
  });

  it('enforces LinkedIn connect note limit on drafts', () => {
    const long = 'a'.repeat(350);
    expect(enforceConnectLimit(long).length).toBeLessThanOrEqual(300);
  });
});

describe('sendWarmContactConnect', () => {
  const mockClient = {
    database: {
      from: vi.fn(),
    },
  } as unknown as Parameters<typeof sendWarmContactConnect>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks send when safety guard rejects', async () => {
    vi.mocked(assertOutreachAllowed).mockResolvedValue({
      allowed: false,
      reason: 'Dry-run mode is on',
      settings: {} as never,
    });

    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'c1',
          user_id: 'u1',
          platform: 'linkedin',
          status: 'drafted',
          outreach_draft: 'Hey - loved your reaction on my post.',
          provider_profile_id: 'prov-1',
          public_identifier: null,
        },
      }),
    };
    vi.mocked(mockClient.database.from).mockReturnValue(chain as never);

    const result = await sendWarmContactConnect(mockClient, 'ws-1', 'u1', 'c1');
    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.message).toContain('Dry-run');
  });

  it('sends when guard allows and updates status', async () => {
    vi.mocked(assertOutreachAllowed).mockResolvedValue({
      allowed: true,
      settings: {} as never,
    });
    vi.mocked(getLinkedInUnipileAccountId).mockResolvedValue('acc-1');
    vi.mocked(sendLinkedInConnectionInvite).mockResolvedValue({
      success: true,
      externalId: 'inv-1',
    });

    const selectChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: 'c1',
          user_id: 'u1',
          platform: 'linkedin',
          status: 'drafted',
          outreach_draft: 'Short note.',
          provider_profile_id: 'prov-1',
          public_identifier: 'jane',
        },
      }),
    };

    let eqCalls = 0;
    const updateChain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(() => {
        eqCalls += 1;
        if (eqCalls >= 2) return Promise.resolve({ data: null, error: null });
        return updateChain;
      }),
    };

    vi.mocked(mockClient.database.from)
      .mockReturnValueOnce(selectChain as never)
      .mockReturnValueOnce(updateChain as never);

    const result = await sendWarmContactConnect(mockClient, 'ws-1', 'u1', 'c1');
    expect(result.ok).toBe(true);
    expect(result.status).toBe('sent');
    expect(sendLinkedInConnectionInvite).toHaveBeenCalledWith('acc-1', 'prov-1', 'Short note.');
  });
});
