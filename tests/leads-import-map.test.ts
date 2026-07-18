/**
 * F9 IMPORT (leads rebuild audit).
 *
 * mapImportRowsToLeads is the pure heart of CSV/spreadsheet import: header
 * alias mapping, externalId synthesis (LinkedIn slug > full email > company
 * slug), and dedupe by externalId. These lock its contract down.
 */
import { describe, it, expect } from 'vitest';
import {
  mapImportRowToLead,
  mapImportRowsToLeads,
  mapExtractedImportLeads,
} from '@/lib/signals/leads/import-map';

describe('F9: header alias mapping', () => {
  it('maps "organization" to the company name', () => {
    const lead = mapImportRowToLead({ organization: 'Acme Robotics', email: 'a@acme.com' });
    expect(lead?.companyName).toBe('Acme Robotics');
  });

  it('maps "account name" to the company name', () => {
    const lead = mapImportRowToLead({ 'account name': 'Beta Corp', email: 'x@beta.com' });
    expect(lead?.companyName).toBe('Beta Corp');
  });

  it('maps "contact name" / "job title" / "person linkedin url" to the founder', () => {
    const lead = mapImportRowToLead({
      company: 'Acme',
      'contact name': 'Jane Doe',
      'job title': 'CEO',
      'person linkedin url': 'https://linkedin.com/in/jane-doe',
    });
    expect(lead?.founders?.[0]).toMatchObject({
      name: 'Jane Doe',
      role: 'CEO',
      linkedinUrl: 'https://linkedin.com/in/jane-doe',
    });
  });

  it('combines split "first name" + "last name" columns', () => {
    const lead = mapImportRowToLead({
      company: 'Gamma',
      'first name': 'Ada',
      'last name': 'Lovelace',
    });
    expect(lead?.founders?.[0]?.name).toBe('Ada Lovelace');
  });

  it('prefixes https:// on a bare website and tags the normalized domain', () => {
    const lead = mapImportRowToLead({ company: 'Acme', name: 'Sam', website: 'acme.com' });
    expect(lead?.website).toBe('https://acme.com');
    expect(lead?.tags).toContain('acme.com');
  });
});

describe('F9: externalId synthesis', () => {
  it('prefers the LinkedIn profile slug', () => {
    const lead = mapImportRowToLead({
      company: 'Acme',
      linkedin: 'https://www.linkedin.com/in/Jane-Doe/',
    });
    expect(lead?.externalId).toBe('import-li-jane-doe');
  });

  it('uses the FULL email (local part + domain) when there is no LinkedIn', () => {
    const lead = mapImportRowToLead({ company: 'Acme', email: 'alex@acme.com' });
    expect(lead?.externalId).toBe('import-alex-acme-com');
  });

  it('same local part at different domains must NOT collide into one id', () => {
    const a = mapImportRowToLead({ company: 'Acme', email: 'alex@acme.com' });
    const b = mapImportRowToLead({ company: 'Other', email: 'alex@other.com' });
    expect(a?.externalId).not.toBe(b?.externalId);
  });

  it('falls back to the slugified company name', () => {
    const lead = mapImportRowToLead({ company: 'Delta Works', name: 'Sam' });
    expect(lead?.externalId).toBe('import-delta-works');
  });
});

describe('F9: row rejection', () => {
  it('rejects a row with a company but no contact identity (no name/linkedin/email)', () => {
    expect(mapImportRowToLead({ company: 'Acme' })).toBeNull();
  });

  it('rejects a row with no usable company or contact at all', () => {
    expect(mapImportRowToLead({ notes: 'random junk' })).toBeNull();
  });
});

describe('F9: dedupe by externalId', () => {
  it('collapses two rows with the same LinkedIn profile into one lead', () => {
    const leads = mapImportRowsToLeads([
      { company: 'Acme', linkedin: 'https://linkedin.com/in/jane-doe' },
      { company: 'Acme Inc', linkedin: 'https://www.linkedin.com/in/JANE-DOE/' },
    ]);
    expect(leads).toHaveLength(1);
  });

  it('keeps distinct contacts distinct', () => {
    const leads = mapImportRowsToLeads([
      { company: 'Acme', email: 'alex@acme.com' },
      { company: 'Other', email: 'alex@other.com' },
    ]);
    expect(leads).toHaveLength(2);
  });

  it('skips unmappable rows without dropping mappable ones', () => {
    const leads = mapImportRowsToLeads([
      { notes: 'junk' },
      { company: 'Acme', email: 'a@acme.com' },
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].companyName).toBe('Acme');
  });
});

describe('F9: mapExtractedImportLeads (LLM-extracted rows)', () => {
  it('routes extracted fields through the same mapping and id synthesis', () => {
    const leads = mapExtractedImportLeads([
      { company_name: 'Acme', contact_name: 'Jane', linkedin_url: 'https://linkedin.com/in/jane' },
    ]);
    expect(leads).toHaveLength(1);
    expect(leads[0].externalId).toBe('import-li-jane');
    expect(leads[0].source).toBe('manual');
  });
});

describe('F9: skipped-count semantics', () => {
  it.todo(
    'integration: importLeads result must reconcile - imported + merged + updated + skipped === input row count, so the UI never reports rows as silently vanished',
  );
});
