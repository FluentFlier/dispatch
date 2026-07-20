import { NextResponse } from 'next/server';
import { handleComposioDisconnect } from '@/lib/composio/disconnect-route';

/**
 * POST /api/integrations/composio/calendar/disconnect
 *
 * Revokes the workspace's Google Calendar grant at Composio, then clears the
 * local row. See handleComposioDisconnect for why the order matters: this route
 * used to null the local flag only, which left the grant live while the UI
 * claimed the calendar was disconnected.
 */
export async function POST(): Promise<NextResponse> {
  return handleComposioDisconnect('googlecalendar');
}
