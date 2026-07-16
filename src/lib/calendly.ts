/** Public booking URL for founder-led onboarding calls. */
export function getBookingUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BOOKING_URL?.trim() ||
    process.env.NEXT_PUBLIC_CALENDLY_URL?.trim() ||
    ''
  );
}

export function isCalendlyUrl(url: string): boolean {
  return url.startsWith('https://calendly.com/');
}

export function getCalendlyUrl(): string {
  return getBookingUrl();
}

export function isCalendlyConfigured(): boolean {
  return isCalendlyUrl(getBookingUrl());
}
