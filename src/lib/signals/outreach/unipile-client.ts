/**
 * Unipile HTTP helpers for Signals outreach (isolated from creator publish path).
 */

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

function getApiKey(): string {
  const key = process.env.UNIPILE_API_KEY;
  if (!key) throw new Error('UNIPILE_API_KEY is not configured');
  return key;
}

export function getLinkedInApiMode(): 'classic' | 'sales_navigator' | 'recruiter' {
  const mode = process.env.SIGNALS_LINKEDIN_API?.toLowerCase();
  if (mode === 'sales_navigator' || mode === 'recruiter') return mode;
  return 'classic';
}

export async function unipileJsonGet(path: string): Promise<Response> {
  return fetch(`${getUnipileBase()}${path}`, {
    headers: {
      'X-API-KEY': getApiKey(),
      accept: 'application/json',
    },
  });
}

export async function unipileJsonPost(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${getUnipileBase()}${path}`, {
    method: 'POST',
    headers: {
      'X-API-KEY': getApiKey(),
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/** Unipile messaging endpoints require multipart/form-data. */
export async function unipileFormPost(
  path: string,
  fields: Record<string, string | string[]>,
): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) form.append(key, item);
    } else {
      form.append(key, value);
    }
  }
  return fetch(`${getUnipileBase()}${path}`, {
    method: 'POST',
    headers: {
      'X-API-KEY': getApiKey(),
      accept: 'application/json',
    },
    body: form,
  });
}

export async function parseUnipileError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { detail?: string; message?: string; title?: string };
    return json.detail ?? json.message ?? json.title ?? text.slice(0, 300);
  } catch {
    return text.slice(0, 300) || `HTTP ${res.status}`;
  }
}
