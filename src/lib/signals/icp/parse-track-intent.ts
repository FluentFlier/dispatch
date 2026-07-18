/** Parsed "track <name> [...]" ICP chat command. */
export interface TrackIntent {
  name: string;
  xHandle?: string;
  linkedinCompanyUrl?: string;
}

const TRACK_CMD_RE = /^track\s+(.+)$/i;
const LINKEDIN_URL_RE = /(https?:\/\/(?:www\.)?linkedin\.com\/company\/\S+)/i;
const X_HANDLE_RE = /(?:\bon\s+x\s+)?@([A-Za-z0-9_]+)/i;

/**
 * Deterministic parse of a "track <name>" ICP chat command, e.g. "track HF0" or
 * "track Speedrun on x @speedrun and linkedin https://linkedin.com/company/speedrun".
 * Returns null when the message isn't a track command.
 * ponytail: word-boundary regex heuristic, not a full NL parser - a company name
 * that itself contains "on x" or "and linkedin" would confuse it. Upgrade to LLM
 * extraction if that turns out to matter in practice.
 */
export function parseTrackIntent(message: string): TrackIntent | null {
  const cmd = TRACK_CMD_RE.exec(message.trim());
  if (!cmd) return null;
  let rest = cmd[1].trim();

  let linkedinCompanyUrl: string | undefined;
  const liMatch = LINKEDIN_URL_RE.exec(rest);
  if (liMatch) {
    linkedinCompanyUrl = liMatch[1];
    rest = rest.replace(liMatch[0], ' ');
  }

  let xHandle: string | undefined;
  const xMatch = X_HANDLE_RE.exec(rest);
  if (xMatch) {
    xHandle = xMatch[1];
    rest = rest.replace(xMatch[0], ' ');
  }

  const name = rest
    .replace(/\band\s+linkedin\b/gi, ' ')
    .replace(/\blinkedin\b/gi, ' ')
    .replace(/\bon\s+x\b/gi, ' ')
    .replace(/\band\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return null;
  return { name, xHandle, linkedinCompanyUrl };
}
