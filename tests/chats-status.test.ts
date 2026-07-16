import { describe, it, expect } from 'vitest';
import { deriveChatStatus, CHAT_STALE_MS } from '@/lib/chats-status';

const NOW = 1_700_000_000_000;
const fresh = new Date(NOW - 1000).toISOString();

type M = Parameters<typeof deriveChatStatus>[0][number];
const assistant = (status?: M['status'], stage?: M['stage']): M => ({ role: 'assistant', status, stage });

describe('deriveChatStatus', () => {
  it('idle when last assistant is done', () => {
    expect(deriveChatStatus([assistant('done')], fresh, NOW)).toEqual({ status: 'idle', stage: null });
  });

  it('running with stage when fresh and generating', () => {
    expect(deriveChatStatus([assistant('running', 'writing')], fresh, NOW)).toEqual({
      status: 'running',
      stage: 'writing',
    });
  });

  it('queued counts as running', () => {
    expect(deriveChatStatus([assistant('queued')], fresh, NOW).status).toBe('running');
  });

  it('stalled when running but row is stale', () => {
    const stale = new Date(NOW - CHAT_STALE_MS - 1).toISOString();
    expect(deriveChatStatus([assistant('running', 'writing')], stale, NOW)).toEqual({
      status: 'stalled',
      stage: null,
    });
  });

  it('idle for empty conversation', () => {
    expect(deriveChatStatus([], fresh, NOW).status).toBe('idle');
  });
});
