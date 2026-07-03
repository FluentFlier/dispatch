/**
 * Public Calendly URL for founder-led onboarding calls.
 * Set NEXT_PUBLIC_CALENDLY_URL in .env.local (e.g. https://calendly.com/you/dispatch-onboarding).
 */
export function getCalendlyUrl(): string {
  return process.env.NEXT_PUBLIC_CALENDLY_URL?.trim() ?? '';
}

export function isCalendlyConfigured(): boolean {
  const url = getCalendlyUrl();
  return url.startsWith('https://calendly.com/');
}
