import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseLeadListStatusParam } from '@/lib/signals/leads/store';
import {
  parseUnipileInboundMessage,
  findLeadForInboundSender,
} from '@/lib/signals/leads/inbound-message';

describe('parseLeadListStatusParam', () => {
  it('maps needs_reply to needsReply filter', () => {
    expect(parseLeadListStatusParam('needs_reply')).toEqual({ needsReply: true });
  });

  it('maps real lead statuses', () => {
    expect(parseLeadListStatusParam('new')).toEqual({ status: 'new' });
  });

  it('returns empty filter for all', () => {
    expect(parseLeadListStatusParam('all')).toEqual({});
    expect(parseLeadListStatusParam(null)).toEqual({});
  });
});

describe('parseUnipileInboundMessage', () => {
  it('parses v1 message_received payloads', () => {
    const parsed = parseUnipileInboundMessage({
      event: 'message_received',
      account_id: 'acc_123',
      message: {
        id: 'msg_1',
        chat_id: 'chat_9',
        text: 'Thanks for reaching out!',
        sender_id: 'ACoAA123',
        is_sender: false,
        timestamp: '2026-07-12T12:00:00.000Z',
        provider: 'linkedin',
      },
    });

    expect(parsed).toMatchObject({
      accountId: 'acc_123',
      messageId: 'msg_1',
      chatId: 'chat_9',
      text: 'Thanks for reaching out!',
      senderProviderId: 'ACoAA123',
      isFromSelf: false,
      channel: 'linkedin_dm',
    });
  });

  it('parses v2 message.new payloads', () => {
    const parsed = parseUnipileInboundMessage({
      type: 'message.new',
      account_id: 'acc_456',
      payload: {
        id: 'msg_2',
        chat_id: 'chat_2',
        body: 'Can we chat next week?',
        sender_provider_id: 'ACoAA999',
        is_sender: false,
      },
    });

    expect(parsed?.text).toBe('Can we chat next week?');
    expect(parsed?.senderProviderId).toBe('ACoAA999');
  });

  it('ignores outbound echoes from self', () => {
    const parsed = parseUnipileInboundMessage({
      event: 'message_received',
      account_id: 'acc_123',
      message: {
        id: 'msg_3',
        text: 'My outbound',
        is_sender: true,
      },
    });

    expect(parsed?.isFromSelf).toBe(true);
  });

  it('returns null for unrelated events', () => {
    expect(parseUnipileInboundMessage({ event: 'account.connected' })).toBeNull();
  });
});

describe('findLeadForInboundSender', () => {
  const outreachMatch = vi.fn();
  const contactProviderMatch = vi.fn();
  const contactsList = vi.fn();

  const client = {
    database: {
      from: (table: string) => {
        if (table === 'signal_outreach') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    limit: () => ({
                      maybeSingle: outreachMatch,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'signal_lead_contacts') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  limit: () => ({
                    maybeSingle: contactProviderMatch,
                  }),
                }),
                not: () => ({
                  limit: contactsList,
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    },
  } as unknown as import('@insforge/sdk').InsForgeClient;

  beforeEach(() => {
    outreachMatch.mockReset();
    contactProviderMatch.mockReset();
    contactsList.mockReset();
  });

  it('matches by linkedin_provider_id on outreach row', async () => {
    outreachMatch.mockResolvedValue({ data: { lead_id: 'lead-abc' } });
    contactProviderMatch.mockResolvedValue({ data: null });
    contactsList.mockResolvedValue({ data: [] });

    const leadId = await findLeadForInboundSender(client, 'ws-1', {
      providerId: 'ACoAA123',
      publicId: null,
    });

    expect(leadId).toBe('lead-abc');
  });
});
