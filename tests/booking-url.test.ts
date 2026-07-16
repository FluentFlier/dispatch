import { afterEach, describe, expect, it } from 'vitest';
import { getBookingUrl, isCalendlyUrl } from '@/lib/calendly';

const originalBookingUrl = process.env.NEXT_PUBLIC_BOOKING_URL;
const originalCalendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;

afterEach(() => {
  if (originalBookingUrl === undefined) delete process.env.NEXT_PUBLIC_BOOKING_URL;
  else process.env.NEXT_PUBLIC_BOOKING_URL = originalBookingUrl;

  if (originalCalendlyUrl === undefined) delete process.env.NEXT_PUBLIC_CALENDLY_URL;
  else process.env.NEXT_PUBLIC_CALENDLY_URL = originalCalendlyUrl;
});

describe('booking URL configuration', () => {
  it('accepts a Google Calendar booking link', () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = ' https://calendar.app.google/example ';
    expect(getBookingUrl()).toBe('https://calendar.app.google/example');
    expect(isCalendlyUrl(getBookingUrl())).toBe(false);
  });

  it('keeps the legacy Calendly variable working', () => {
    delete process.env.NEXT_PUBLIC_BOOKING_URL;
    process.env.NEXT_PUBLIC_CALENDLY_URL = 'https://calendly.com/founder/demo';
    expect(getBookingUrl()).toBe('https://calendly.com/founder/demo');
    expect(isCalendlyUrl(getBookingUrl())).toBe(true);
  });

  it('prefers the generic booking URL', () => {
    process.env.NEXT_PUBLIC_BOOKING_URL = 'https://calendar.app.google/example';
    process.env.NEXT_PUBLIC_CALENDLY_URL = 'https://calendly.com/founder/demo';
    expect(getBookingUrl()).toBe('https://calendar.app.google/example');
  });
});
