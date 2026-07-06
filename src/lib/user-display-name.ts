interface ResolveDisplayNameInput {
  oauthName?: string | null;
  fallback?: string | null;
}

function cleanName(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withoutEmailDomain = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const normalized = withoutEmailDomain.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || null;
}

export function resolveDisplayName({ oauthName, fallback }: ResolveDisplayNameInput): string {
  return cleanName(oauthName) ?? cleanName(fallback) ?? 'Creator';
}
