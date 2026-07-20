import { NextResponse } from 'next/server';
import { handleComposioDisconnect } from '@/lib/composio/disconnect-route';

/**
 * POST /api/integrations/composio/gmail/disconnect
 *
 * Revokes the workspace's Gmail grant at Composio, then clears the local row.
 * See handleComposioDisconnect for why the order matters.
 */
export async function POST(): Promise<NextResponse> {
  return handleComposioDisconnect('gmail');
}
