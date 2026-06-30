import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn(),
  ensureSoloWorkspace: vi.fn(),
}));
vi.mock('@/lib/demo/seed-workspace', () => ({
  seedDemoWorkspace: vi.fn().mockResolvedValue({ seeded: true }),
}));
vi.mock('@/lib/logger', () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import { seedDemoWorkspace } from '@/lib/demo/seed-workspace';
import { POST } from '@/app/api/demo/seed/route';
import { NextRequest } from 'next/server';

/** Chainable InsForge query stub resolving maybeSingle() to the given result. */
function membershipClient(result: { data: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  return { database: { from: () => chain } } as unknown as ReturnType<typeof getServiceClient>;
}

function opsRequest(bearer: string | null, body: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer !== null) headers.authorization = bearer;
  return new NextRequest('http://localhost/api/demo/seed', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

const TARGET_USER = '11111111-1111-4111-8111-111111111111';
const TARGET_WS = '22222222-2222-4222-8222-222222222222';

describe('Phase: Demo-seed hardening (S5-1..S5-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEMO_SEED_SECRET = 'right-secret';
    vi.stubEnv('NODE_ENV', 'production');
  });
  afterEach(() => {
    delete process.env.DEMO_SEED_SECRET;
    vi.unstubAllEnvs();
  });

  it('S5-1: rejects ops mode with a wrong Bearer secret (no seed runs)', async () => {
    const res = await POST(opsRequest('Bearer wrong-secret', { user_id: TARGET_USER }));
    expect(res.status).toBe(403);
    expect(seedDemoWorkspace).not.toHaveBeenCalled();
  });

  it('S5-2: rejects ops mode when the user does not own the target workspace', async () => {
    vi.mocked(getServiceClient).mockReturnValue(membershipClient({ data: null }));
    const res = await POST(
      opsRequest('Bearer right-secret', { user_id: TARGET_USER, workspace_id: TARGET_WS }),
    );
    expect(res.status).toBe(403);
    expect(seedDemoWorkspace).not.toHaveBeenCalled();
  });

  it('S5-2b: allows ops mode when the user owns the target workspace', async () => {
    vi.mocked(getServiceClient).mockReturnValue(membershipClient({ data: { workspace_id: TARGET_WS } }));
    const res = await POST(
      opsRequest('Bearer right-secret', { user_id: TARGET_USER, workspace_id: TARGET_WS }),
    );
    expect(res.status).toBe(200);
    expect(seedDemoWorkspace).toHaveBeenCalledWith(expect.anything(), TARGET_USER, TARGET_WS);
  });

  it('S5-3: self-seed without authentication is unauthorized', async () => {
    // Seeding enabled so we reach the auth check rather than the disabled gate.
    process.env.DEMO_SEED_ENABLED = 'true';
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
    const res = await POST(opsRequest(null, {}));
    expect(res.status).toBe(401);
    expect(seedDemoWorkspace).not.toHaveBeenCalled();
    delete process.env.DEMO_SEED_ENABLED;
  });
});
