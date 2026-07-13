import { describe, expect, it } from 'vitest';
import { parseDelimitedText } from '@/lib/signals/leads/import-parse';
import { mapImportRowToLead, mapImportRowsToLeads } from '@/lib/signals/leads/import-map';

describe('parseDelimitedText', () => {
  it('parses CSV with headers', () => {
    const rows = parseDelimitedText(
      'company_name,name,linkedin_url\nAcme Inc,Jane Doe,https://linkedin.com/in/jane-doe\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].company_name).toBe('Acme Inc');
    expect(rows[0].linkedin_url).toContain('linkedin.com/in/jane-doe');
  });
});

describe('mapImportRowToLead', () => {
  it('maps a full row to manual IngestedLead', () => {
    const lead = mapImportRowToLead({
      company_name: 'Acme Inc',
      name: 'Jane Doe',
      role: 'CEO',
      linkedin_url: 'https://www.linkedin.com/in/jane-doe',
      email: 'jane@acme.com',
      website: 'acme.com',
    });
    expect(lead?.source).toBe('manual');
    expect(lead?.companyName).toBe('Acme Inc');
    expect(lead?.founders?.[0]?.linkedinUrl).toContain('jane-doe');
    expect(lead?.externalId).toBe('import-li-jane-doe');
  });

  it('accepts LinkedIn-only rows', () => {
    const lead = mapImportRowToLead({
      linkedin: 'https://linkedin.com/in/founder-co',
    });
    expect(lead?.founders?.[0]?.linkedinUrl).toContain('founder-co');
    expect(lead?.companyName).toBeTruthy();
  });

  it('maps Apollo-style columns (first/last name, person linkedin url)', () => {
    const lead = mapImportRowToLead({
      company: 'Nova Labs',
      'first name': 'Alex',
      'last name': 'Rivera',
      title: 'VP Sales',
      email: 'alex@novalabs.io',
      'person linkedin url': 'https://www.linkedin.com/in/alex-rivera',
      website: 'novalabs.io',
    });
    expect(lead?.companyName).toBe('Nova Labs');
    expect(lead?.founders?.[0]?.name).toBe('Alex Rivera');
    expect(lead?.founders?.[0]?.role).toBe('VP Sales');
    expect(lead?.founders?.[0]?.linkedinUrl).toContain('alex-rivera');
  });

  it('dedupes by external id', () => {
    const rows = [
      { company_name: 'Acme', linkedin_url: 'https://linkedin.com/in/jane-doe' },
      { company_name: 'Acme Corp', linkedin_url: 'https://linkedin.com/in/jane-doe' },
    ];
    expect(mapImportRowsToLeads(rows)).toHaveLength(1);
  });
});
