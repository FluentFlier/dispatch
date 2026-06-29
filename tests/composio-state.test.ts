import { describe, expect, it } from 'vitest';
import { decodeComposioState, encodeComposioState } from '@/lib/composio/state';

describe('composio OAuth state', () => {
  it('round-trips signed state', () => {
    process.env.COMPOSIO_STATE_SECRET = 'test-secret';
    const raw = encodeComposioState({
      workspaceId: 'ws-1',
      userId: 'user-1',
      toolkit: 'slack',
    });
    const decoded = decodeComposioState(raw);
    expect(decoded).toEqual({
      workspaceId: 'ws-1',
      userId: 'user-1',
      toolkit: 'slack',
    });
  });

  it('rejects tampered state', () => {
    process.env.COMPOSIO_STATE_SECRET = 'test-secret';
    const raw = encodeComposioState({
      workspaceId: 'ws-1',
      userId: 'user-1',
      toolkit: 'slack',
    });
    expect(decodeComposioState(`${raw}x`)).toBeNull();
  });
});
