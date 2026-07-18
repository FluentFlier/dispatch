/**
 * Phase: Leads watchlist dedup - UI warning + never-contact-again (Task 11)
 *
 * (a) parseDuplicateResponse maps the approve route's 409 body to warning
 *     state (or null when it isn't a duplicate block).
 * (b) buildApproveBody carries overrideDuplicate: true on a "Send anyway" retry.
 * (c) POST /api/leads/:id/do-not-contact inserts the lead's identity (mock
 *     client), 404s an unknown lead, and no-ops when the lead has no identity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildApproveBody,
  channelLabel,
  formatDuplicateWarning,
  parseDuplicateResponse,
} from '@/lib/leads/duplicate-warning';

describe('parseDuplicateResponse', () => {
  it('maps a duplicate 409 body to warning state', () => {
    const state = parseDuplicateResponse({
      duplicate: true,
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
      leadId: 'otherLead',
    });
    expect(state).toEqual({
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
    });
  });

  it('marks the DNC variant with no lastAt/channel required', () => {
    const state = parseDuplicateResponse({ duplicate: true, blockedByDnc: true });
    expect(state).toEqual({ blockedByDnc: true, lastAt: null, channel: null });
  });

  it('returns null for a non-duplicate error body', () => {
    expect(parseDuplicateResponse({ error: 'Draft the message before approving.' })).toBeNull();
  });

  it('returns null for a success body', () => {
    expect(parseDuplicateResponse({ lead: { id: 'l1' } })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseDuplicateResponse(null)).toBeNull();
    expect(parseDuplicateResponse(undefined)).toBeNull();
  });
});

describe('formatDuplicateWarning', () => {
  it('formats the standard duplicate message with a human channel label', () => {
    const msg = formatDuplicateWarning({
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'x_dm',
    });
    expect(msg).toContain('Already contacted');
    expect(msg).toContain('via X DM');
  });

  it('formats the DNC variant without a date/channel', () => {
    const msg = formatDuplicateWarning({ blockedByDnc: true, lastAt: null, channel: null });
    expect(msg).toBe('This contact is on your do-not-contact list.');
  });
});

describe('channelLabel', () => {
  it('maps known channels to display labels', () => {
    expect(channelLabel('linkedin_connect')).toBe('LinkedIn');
    expect(channelLabel('linkedin_dm')).toBe('LinkedIn DM');
    expect(channelLabel('x_dm')).toBe('X DM');
    expect(channelLabel('gmail')).toBe('email');
  });

  it('falls back to underscore-stripped text for an unknown channel', () => {
    expect(channelLabel('carrier_pigeon')).toBe('carrier pigeon');
  });

  it('falls back for a missing channel', () => {
    expect(channelLabel(null)).toBe('another channel');
  });
});

describe('buildApproveBody', () => {
  it('carries overrideDuplicate: true on a "Send anyway" retry', () => {
    const body = buildApproveBody('linkedin_connect', 'hi there', { overrideDuplicate: true });
    expect(body).toEqual({
      channel: 'linkedin_connect',
      messageText: 'hi there',
      emailOptIn: undefined,
      overrideDuplicate: true,
    });
  });

  it('omits overrideDuplicate on the first attempt', () => {
    const body = buildApproveBody('x_dm', 'hi');
    expect(body.overrideDuplicate).toBeUndefined();
  });

  it('carries emailOptIn for the cold-email retry path', () => {
    const body = buildApproveBody('gmail', 'hi', { emailOptIn: true, overrideDuplicate: true });
    expect(body).toEqual({
      channel: 'gmail',
      messageText: 'hi',
      emailOptIn: true,
      overrideDuplicate: true,
    });
  });
});

// --- POST /api/leads/:id/do-not-contact ---

const getAuthenticatedUser = vi.fn();
const getServerClient = vi.fn();
vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: (...a: unknown[]) => getAuthenticatedUser(...a),
  getServerClient: (...a: unknown[]) => getServerClient(...a),
}));
const getActiveWorkspaceId = vi.fn();
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: (...a: unknown[]) => getActiveWorkspaceId(...a),
}));
const getLead = vi.fn();
vi.mock('@/lib/signals/leads/store', () => ({
  getLead: (...a: unknown[]) => getLead(...a),
}));

import { POST } from '@/app/api/leads/[id]/do-not-contact/route';

function req() {
  return {} as unknown as Parameters<typeof POST>[0];
}

/** Fake InsForge client recording insert() calls, same shape as tests/phase-dedup-send-paths.test.ts. */
function makeClient() {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const database = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        return builder;
      };
      builder.select = () => Promise.resolve({ data: [{ id: 'dnc1' }], error: null });
      return builder;
    },
  };
  return { client: { database } as unknown as ReturnType<typeof getServerClient>, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: 'u1' });
  getActiveWorkspaceId.mockResolvedValue('ws1');
});

afterEach(() => vi.restoreAllMocks());

describe('POST /api/leads/:id/do-not-contact', () => {
  it('inserts the lead identity with reason user_marked', async () => {
    const { client, inserts } = makeClient();
    getServerClient.mockReturnValue(client);
    getLead.mockResolvedValue({
      id: 'l1',
      primary_contact: {
        provider_id: 'prov-9',
        linkedin_url: 'https://linkedin.com/in/jane',
        x_handle: null,
        email: null,
      },
      contacts: [],
    });

    const res = await POST(req(), { params: { id: 'l1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('do_not_contact');
    expect(inserts[0].payload).toEqual([
      {
        workspace_id: 'ws1',
        linkedin_provider_id: 'prov-9',
        linkedin_url: 'https://linkedin.com/in/jane',
        x_handle: null,
        email: null,
        reason: 'user_marked',
      },
    ]);
  });

  it('falls back to a secondary contact email when the primary has none', async () => {
    const { client, inserts } = makeClient();
    getServerClient.mockReturnValue(client);
    getLead.mockResolvedValue({
      id: 'l1',
      primary_contact: { provider_id: null, linkedin_url: null, x_handle: null, email: null },
      contacts: [
        { provider_id: null, linkedin_url: null, x_handle: null, email: null },
        { provider_id: null, linkedin_url: null, x_handle: null, email: 'john@acme.ai' },
      ],
    });

    await POST(req(), { params: { id: 'l1' } });
    expect((inserts[0].payload as Array<{ email: string | null }>)[0].email).toBe('john@acme.ai');
  });

  it('404s when the lead does not exist', async () => {
    const { client } = makeClient();
    getServerClient.mockReturnValue(client);
    getLead.mockResolvedValue(null);

    const res = await POST(req(), { params: { id: 'missing' } });
    expect(res.status).toBe(404);
  });

  it('no-ops (200, skipped) when the lead has no identity fields', async () => {
    const { client, inserts } = makeClient();
    getServerClient.mockReturnValue(client);
    getLead.mockResolvedValue({
      id: 'l1',
      primary_contact: { provider_id: null, linkedin_url: null, x_handle: null, email: null },
      contacts: [],
    });

    const res = await POST(req(), { params: { id: 'l1' } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.skipped).toBe(true);
    expect(inserts).toHaveLength(0);
  });

  it('401s an unauthenticated request', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await POST(req(), { params: { id: 'l1' } });
    expect(res.status).toBe(401);
  });
});
