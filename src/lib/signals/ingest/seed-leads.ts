import type { IngestedLead } from '@/lib/signals/types';

/**
 * Deterministic seed leads used when TINYFISH_API_KEY is absent, so the full
 * directory-lead pipeline (dedupe → resolve → score → draft → Today tab) is
 * testable end-to-end without live scraping. Mix of contact availability:
 * some founders carry a linkedin_url (→ resolvable), some don't (→ enrichment
 * or no_contact), exercising every contact_status branch.
 */
export const SEED_DIRECTORY_LEADS: IngestedLead[] = [
  {
    source: 'yc_directory',
    externalId: 'seed-flux-labs',
    companyName: 'Flux Labs',
    tagline: 'Realtime analytics for embedded AI agents',
    website: 'https://fluxlabs.ai',
    batch: 'S24',
    tags: ['AI', 'Analytics', 'Developer Tools'],
    founders: [
      { name: 'Ava Chen', role: 'Founder, CEO', linkedinUrl: 'https://www.linkedin.com/in/ava-chen-flux' },
    ],
  },
  {
    source: 'yc_directory',
    externalId: 'seed-northwind',
    companyName: 'Northwind',
    tagline: 'Compliance automation for fintech startups',
    website: 'https://northwind.co',
    batch: 'S24',
    tags: ['Fintech', 'Compliance', 'SaaS'],
    founders: [
      { name: 'Diego Ramos', role: 'Co-founder, CEO', linkedinUrl: 'https://www.linkedin.com/in/diego-ramos-nw' },
      { name: 'Priya Nair', role: 'Co-founder, CTO' },
    ],
  },
  {
    source: 'yc_directory',
    externalId: 'seed-orbital',
    companyName: 'Orbital Freight',
    tagline: 'Logistics OS for cross-border SMB shippers',
    website: 'https://orbitalfreight.com',
    batch: 'S24',
    tags: ['Logistics', 'Marketplace'],
    founders: [{ name: 'Sam Okafor', role: 'Founder' }],
  },
  {
    source: 'yc_directory',
    externalId: 'seed-verdant',
    companyName: 'Verdant',
    tagline: 'Carbon accounting for manufacturers',
    website: 'https://verdant.eco',
    batch: 'S24',
    tags: ['Climate', 'Enterprise'],
    intentFlags: { hiring: true },
    founders: [
      { name: 'Lena Fischer', role: 'CEO', linkedinUrl: 'https://www.linkedin.com/in/lena-fischer-verdant' },
    ],
  },
  {
    source: 'yc_directory',
    externalId: 'seed-quill',
    companyName: 'Quill',
    tagline: 'AI copilots for legal ops teams',
    website: 'https://quill.legal',
    batch: 'S24',
    tags: ['AI', 'Legal', 'SaaS'],
    founders: [{ name: 'Marcus Webb', role: 'Founder, CEO' }],
  },
  {
    source: 'yc_directory',
    externalId: 'seed-harbor',
    companyName: 'Harbor',
    tagline: 'Vertical CRM for boutique agencies',
    website: 'https://harbor.app',
    batch: 'S24',
    tags: ['CRM', 'SaaS', 'SMB'],
    founders: [
      { name: 'Nadia Volkov', role: 'Co-founder', linkedinUrl: 'https://www.linkedin.com/in/nadia-volkov-harbor' },
    ],
  },
];
