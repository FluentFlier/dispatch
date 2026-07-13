/**
 * Normalizes a user-pasted scheduling URL for safe use in outreach drafts.
 * Accepts Calendly, Google Calendar appointment links, HubSpot, etc.
 */

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export interface NormalizedMeetingLink {
  url: string;
  provider: 'calendly' | 'google' | 'hubspot' | 'cal' | 'other';
  label: string;
}

function detectProvider(host: string): NormalizedMeetingLink['provider'] {
  const h = host.toLowerCase();
  if (h.includes('calendly.com')) return 'calendly';
  if (h.includes('calendar.google.com') || h.includes('google.com')) return 'google';
  if (h.includes('hubspot.com')) return 'hubspot';
  if (h === 'cal.com' || h.endsWith('.cal.com')) return 'cal';
  return 'other';
}

function providerLabel(provider: NormalizedMeetingLink['provider']): string {
  switch (provider) {
    case 'calendly':
      return 'Calendly';
    case 'google':
      return 'Google Calendar';
    case 'hubspot':
      return 'HubSpot meetings';
    case 'cal':
      return 'Cal.com';
    default:
      return 'scheduling link';
  }
}

/** Parses and validates a scheduling URL. Returns null if invalid or unsafe. */
export function normalizeMeetingLink(raw: string | null | undefined): NormalizedMeetingLink | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (BLOCKED_HOSTS.has(url.hostname)) return null;

  const provider = detectProvider(url.hostname);
  return {
    url: url.toString(),
    provider,
    label: providerLabel(provider),
  };
}

/** One-line instruction for LLM prompts when a meeting link is configured. */
export function meetingLinkPromptLine(link: NormalizedMeetingLink | null): string | null {
  if (!link) return null;
  return `When suggesting a call, end with this exact scheduling link on its own line: ${link.url}`;
}
