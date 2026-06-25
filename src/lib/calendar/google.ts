import { decryptToken, encryptToken } from '@/lib/crypto';

// --- Types ---

/** A single Google Calendar event returned by the Events.list API. */
export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  attendees?: Array<{
    displayName?: string;
    email?: string;
    responseStatus?: string;
    organizer?: boolean;
    self?: boolean;
  }>;
  status?: string;
  htmlLink?: string;
}

/** A single calendar entry returned by CalendarList.list. */
export interface GoogleCalendarListEntry {
  id: string;
  summary?: string;
  description?: string;
  timeZone?: string;
  primary?: boolean;
  accessRole?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleEventsResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarListEntry[];
}

// --- OAuth helpers ---

/**
 * Builds the Google OAuth 2.0 authorization URL for Calendar read scope.
 * Appends access_type=offline to receive a refresh token on first consent.
 * State is a caller-provided nonce stored in a short-lived cookie to prevent CSRF.
 */
export function buildGoogleOAuthUrl(state: string): string {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CALENDAR_CLIENT_ID is not configured');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/calendar/callback/google`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges an authorization code for access + refresh tokens.
 * Called once during the OAuth callback — stores both tokens (encrypted) in the DB.
 * Returns raw tokens; caller is responsible for encrypting before persistence.
 */
export async function exchangeGoogleCode(
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date }> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth credentials not configured');
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const redirectUri = `${appUrl}/api/calendar/callback/google`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  };
}

/**
 * Refreshes a Google access token using the stored (encrypted) refresh token.
 * Called by the Stage 1 cron when token_expires_at < now + 5 minutes.
 * Returns the new access token (plaintext) and its expiry — caller encrypts and upserts.
 */
export async function refreshGoogleToken(
  encryptedRefreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date }> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth credentials not configured');
  }

  const refreshToken = decryptToken(encryptedRefreshToken);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as GoogleTokenResponse;
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  return { accessToken: data.access_token, expiresAt };
}

/**
 * Fetches calendar events from a user's Google Calendar for a given time window.
 * Used by the Stage 1 cron to mirror events into event_captures.
 * timeMin defaults to last_synced_at (or now-3h for the first run) to avoid re-fetching old events.
 */
export async function fetchCalendarEvents(
  encryptedAccessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleCalendarEvent[]> {
  const accessToken = decryptToken(encryptedAccessToken);

  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  });

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar events fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as GoogleEventsResponse;
  return data.items ?? [];
}

/**
 * Lists all calendars available to the authenticated user.
 * Called once during OAuth callback to let the user choose which calendar to sync.
 * Returns the primary calendar first when one is marked as such.
 */
export async function listCalendars(
  encryptedAccessToken: string,
): Promise<GoogleCalendarListEntry[]> {
  const accessToken = decryptToken(encryptedAccessToken);

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar list fetch failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as GoogleCalendarListResponse;
  const items = data.items ?? [];

  // Primary calendar first — most users connect their main calendar.
  return [
    ...items.filter((c) => c.primary),
    ...items.filter((c) => !c.primary),
  ];
}
