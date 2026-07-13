import type { LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

/**
 * LinkedIn company/people discovery adapter — stub for a dedicated implementation.
 * Wire Unipile search, Sales Nav export, or Apify here; the registry already routes
 * enabled `linkedin` sources through this adapter.
 */
export const linkedinDiscoveryAdapter: LeadDiscoveryAdapter = {
  source: 'linkedin',
  label: 'LinkedIn',
  category: 'social',
  isAvailable: () => false,
  discover: async () => [],
};

/**
 * X / Twitter lead discovery — stub for teammate's implementation.
 * Signal posts (live X mentions) already flow through the Signals engine; this
 * adapter is for proactive company/prospect discovery from X.
 */
export const xDiscoveryAdapter: LeadDiscoveryAdapter = {
  source: 'x',
  label: 'X',
  category: 'social',
  isAvailable: () => false,
  discover: async () => [],
};

export const socialAdapters: LeadDiscoveryAdapter[] = [
  linkedinDiscoveryAdapter,
  xDiscoveryAdapter,
];
