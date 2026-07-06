import { describe, expect, it } from 'vitest';
import { buildLeadPlaybook, connectDueAt } from '@/lib/gtm/nurture/playbook';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

const baseLead = (): SignalLeadWithContacts => ({
  id: 'l1',
  workspace_id: 'ws1',
  source: 'yc_directory',
  external_id: 'acme',
  company_name: 'Acme AI',
  tagline: 'AI for finance teams',
  website: 'https://acme.ai',
  domain: 'acme.ai',
  batch: 'W24',
  tags: ['fintech', 'b2b'],
  intent_flags: { raised: true },
  source_fact: {},
  name_history: [],
  fit_score: 0.8,
  rank_score: 0.9,
  contact_status: 'resolved',
  lead_status: 'new',
  first_seen_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  digest_date: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  primary_contact: {
    id: 'c1',
    lead_id: 'l1',
    workspace_id: 'ws1',
    name: 'Jane Doe',
    role: 'CEO',
    linkedin_url: 'https://linkedin.com/in/jane',
    x_handle: null,
    email: null,
    provider_id: null,
    resolution_source: 'scraped',
    enriched_via: null,
    is_primary: true,
    created_at: new Date().toISOString(),
  },
});

describe('gtm nurture playbook', () => {
  it('builds a 4-step playbook from lead context', () => {
    const pb = buildLeadPlaybook(baseLead());
    expect(pb.whyThem).toContain('Acme AI');
    expect(pb.steps).toHaveLength(4);
    expect(pb.steps.map((s) => s.type)).toEqual(['research', 'comment', 'connect', 'dm']);
  });

  it('schedules connect step due in future days', () => {
    const pb = buildLeadPlaybook(baseLead());
    const from = new Date('2026-07-06T12:00:00Z');
    const due = connectDueAt(pb, from);
    expect(due.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('gtm-nurture cron wiring', () => {
  it('medium fan-out includes gtm-nurture', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/app/api/cron/medium/route.ts'),
      'utf8',
    );
    expect(src).toContain('/api/cron/gtm-nurture');
  });
});
