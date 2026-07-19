import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getServerClient: vi.fn(),
  getAuthenticatedUser: vi.fn(),
}));
vi.mock('@/lib/user-display-name', () => ({
  displayNameFromAuthUser: () => '',
  resolveDisplayName: ({ fallback }: { fallback: string }) => fallback,
}));

import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import {
  completeOnboardingFromBaseline,
  completeOnboardingMinimal,
} from '@/app/(dashboard)/onboarding/actions';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';

interface Captured { table: string; payload: Record<string, unknown> }

const BASELINE: CreatorBaseline = {
  voiceSummary: 'Direct, no-fluff, technical founder voice.',
  voiceRules: ['Keep sentences short.', 'No corporate jargon.'],
  themes: ['Fintech'],
  hookPattern: 'Opens with a bold claim',
  tone: 'Conversational and direct',
  postsAnalyzed: 10,
  emailsAnalyzed: 5,
  platforms: ['linkedin'],
  displayName: 'Alex',
  suggestedTopic: 'A lesson about fintech',
  pillars: [{ name: 'Fintech', color: '#E07A5F', description: 'Content about fintech' }],
};

/** InsForge stub that records upserts and returns one workspace membership. */
function stubClient(captured: Captured[]) {
  const chain = (table: string): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.eq = () => self;
    self.limit = () => self;
    self.maybeSingle = () => Promise.resolve({ data: null });
    self.then = undefined;
    self.upsert = (payload: Record<string, unknown>) => {
      captured.push({ table, payload });
      return Promise.resolve({ error: null });
    };
    return self;
  };

  return {
    database: {
      from: (table: string) => {
        if (table === 'workspace_members') {
          return {
            select: () => ({ eq: () => Promise.resolve({ data: [{ workspace_id: 'ws-1' }] }) }),
          };
        }
        return chain(table);
      },
    },
  } as unknown as ReturnType<typeof getServerClient>;
}

beforeEach(() => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
});

describe('completeOnboardingMinimal', () => {
  it('stores derived pillars when they are supplied', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingMinimal('Alex', [
      { name: 'GTM', color: '#E07A5F', description: 'Sales' },
      { name: 'Fintech', color: '#D4A054', description: 'Treasury' },
    ]);

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile).toBeDefined();
    expect(profile!.payload.onboarding_complete).toBe(true);
    expect(profile!.payload.content_pillars).toHaveLength(2);
  });

  it('falls back to a single default pillar when none are supplied', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingMinimal('Alex');

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile!.payload.content_pillars).toHaveLength(1);
  });

  it('never stores an empty pillar list', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingMinimal('Alex', []);

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect((profile!.payload.content_pillars as unknown[]).length).toBeGreaterThan(0);
  });

  it('persists a supplied voice description and voice rules instead of discarding them', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingMinimal('Alex', undefined, {
      description: 'VERIFY-EDIT voice description',
      rules: 'Keep it short.\nNo jargon.',
    });

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile!.payload.voice_description).toBe('VERIFY-EDIT voice description');
    expect(profile!.payload.voice_rules).toBe('Keep it short.\nNo jargon.');
  });

  it('does not include a bio_facts key in the upsert payload', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingMinimal('Alex');

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile!.payload).not.toHaveProperty('bio_facts');
  });

  it('writes empty strings for voice fields and still succeeds when voice is omitted', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    const result = await completeOnboardingMinimal('Alex');

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile!.payload.voice_description).toBe('');
    expect(profile!.payload.voice_rules).toBe('');
    expect(result).toEqual({ success: true });
  });
});

describe('completeOnboardingFromBaseline', () => {
  it('does not overwrite bio_facts, but still writes voice_description, voice_rules, and content_pillars', async () => {
    const captured: Captured[] = [];
    vi.mocked(getServerClient).mockReturnValue(stubClient(captured));

    await completeOnboardingFromBaseline(BASELINE);

    const profile = captured.find((c) => c.table === 'creator_profile');
    expect(profile).toBeDefined();
    expect(profile!.payload).not.toHaveProperty('bio_facts');
    expect(profile!.payload.voice_description).toBe(BASELINE.voiceSummary.trim());
    expect(profile!.payload.voice_rules).toBe(BASELINE.voiceRules.join('\n'));
    expect(profile!.payload.content_pillars).toEqual(BASELINE.pillars);
  });
});
