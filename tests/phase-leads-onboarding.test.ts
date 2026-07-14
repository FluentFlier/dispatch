import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GTM_PLAYBOOK,
  DEFAULT_GTM_SOURCES,
  DESIGN_PARTNER_GTM_PLAYBOOK,
  DESIGN_PARTNER_GTM_SOURCES,
  gtmPlaybookForWorkspace,
  gtmSourcesForWorkspace,
  isDesignPartnerWorkspace,
} from '@/lib/signals/defaults';
import { isLeadsDemoMode } from '@/lib/signals/ingest/config';

/**
 * WS2 - First-run posture: no design-partner (Rho) alpha data leaks into a
 * generic workspace, and demo data is detectable so the UI can badge it.
 */

const DP = process.env.DESIGN_PARTNER_WORKSPACE_ID;
const TF = process.env.TINYFISH_API_KEY;

afterEach(() => {
  if (DP === undefined) delete process.env.DESIGN_PARTNER_WORKSPACE_ID;
  else process.env.DESIGN_PARTNER_WORKSPACE_ID = DP;
  if (TF === undefined) delete process.env.TINYFISH_API_KEY;
  else process.env.TINYFISH_API_KEY = TF;
});

describe('WS2 default playbook is neutral (no Rho leak)', () => {
  it('carries no Rho-specific branding in any field', () => {
    const blob = JSON.stringify(DEFAULT_GTM_PLAYBOOK).toLowerCase();
    expect(blob).not.toContain('rho');
    expect(blob).not.toContain('mercury');
    expect(blob).not.toContain('brex');
  });

  it('keeps the Rho pitch only in the design-partner playbook', () => {
    expect(JSON.stringify(DESIGN_PARTNER_GTM_PLAYBOOK)).toContain('Rho');
  });

  it('default watchlist drops the design-partner-only handles', () => {
    const handles = DEFAULT_GTM_SOURCES.map((s) => s.handle_or_url.toLowerCase());
    expect(handles).not.toContain('harj');
    // The fuller set (design partner) still has them.
    expect(DESIGN_PARTNER_GTM_SOURCES.map((s) => s.handle_or_url.toLowerCase())).toContain('harj');
  });
});

describe('WS2 design-partner gating', () => {
  it('isDesignPartnerWorkspace matches only the configured id', () => {
    delete process.env.DESIGN_PARTNER_WORKSPACE_ID;
    expect(isDesignPartnerWorkspace('ws-generic')).toBe(false);

    process.env.DESIGN_PARTNER_WORKSPACE_ID = 'ws-partner';
    expect(isDesignPartnerWorkspace('ws-partner')).toBe(true);
    expect(isDesignPartnerWorkspace('ws-generic')).toBe(false);
  });

  it('a generic workspace gets the neutral playbook + watchlist', () => {
    process.env.DESIGN_PARTNER_WORKSPACE_ID = 'ws-partner';
    expect(gtmPlaybookForWorkspace('ws-generic')).toBe(DEFAULT_GTM_PLAYBOOK);
    expect(gtmSourcesForWorkspace('ws-generic')).toBe(DEFAULT_GTM_SOURCES);
  });

  it('the design-partner workspace gets the Rho playbook + fuller watchlist', () => {
    process.env.DESIGN_PARTNER_WORKSPACE_ID = 'ws-partner';
    expect(gtmPlaybookForWorkspace('ws-partner')).toBe(DESIGN_PARTNER_GTM_PLAYBOOK);
    expect(gtmSourcesForWorkspace('ws-partner')).toBe(DESIGN_PARTNER_GTM_SOURCES);
  });

  it('with no env configured, every workspace is generic (neutral)', () => {
    delete process.env.DESIGN_PARTNER_WORKSPACE_ID;
    expect(gtmPlaybookForWorkspace('ws-partner')).toBe(DEFAULT_GTM_PLAYBOOK);
  });
});

describe('WS2 demo-data detection', () => {
  const prevSeed = process.env.SIGNALS_DEMO_SEED;
  afterEach(() => {
    if (prevSeed === undefined) delete process.env.SIGNALS_DEMO_SEED;
    else process.env.SIGNALS_DEMO_SEED = prevSeed;
  });

  it('is demo only when the seed flag is on AND no TinyFish key is configured', () => {
    delete process.env.TINYFISH_API_KEY;
    process.env.SIGNALS_DEMO_SEED = '1';
    expect(isLeadsDemoMode()).toBe(true);
  });

  it('is NOT demo with no key but no seed flag (feed is real keyless YC Algolia)', () => {
    delete process.env.TINYFISH_API_KEY;
    delete process.env.SIGNALS_DEMO_SEED;
    expect(isLeadsDemoMode()).toBe(false);
  });

  it('is not demo when a TinyFish key is present', () => {
    process.env.TINYFISH_API_KEY = 'tf-live-key';
    process.env.SIGNALS_DEMO_SEED = '1';
    expect(isLeadsDemoMode()).toBe(false);
  });
});
