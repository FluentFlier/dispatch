/** Sample CSV aligned with Dispatch column mapping (also works as a blank template). */
export const LEAD_IMPORT_SAMPLE_CSV = `company_name,name,role,linkedin_url,email,website,tagline
Acme Robotics,Jane Doe,CEO,https://www.linkedin.com/in/jane-doe,jane@acme.com,https://acme.com,Autonomous warehouse robots
Orbit Health,John Smith,Founder,https://www.linkedin.com/in/john-smith,,orbithealth.io,Clinical AI platform
`;

export interface LeadImportExportGuide {
  id: string;
  title: string;
  steps: string[];
}

export const LEAD_IMPORT_EXPORT_GUIDES: LeadImportExportGuide[] = [
  {
    id: 'apollo',
    title: 'Apollo',
    steps: [
      'Open a list or search in Apollo and select the contacts you want.',
      'Click Export → CSV.',
      'Include Company, Name (or First/Last), Title, Email, and Person LinkedIn URL.',
      'Upload the CSV here — Apollo column names are mapped automatically.',
    ],
  },
  {
    id: 'clay',
    title: 'Clay',
    steps: [
      'Open your Clay table with enriched contacts.',
      'Export as CSV or Excel (.xlsx).',
      'Include company, contact name, LinkedIn profile URL, and email when available.',
      'Upload here — LinkedIn URLs are used first for outreach resolution.',
    ],
  },
  {
    id: 'hubspot',
    title: 'HubSpot',
    steps: [
      'Go to Contacts or Companies → select records → Export.',
      'Choose CSV and include company name, contact name, email, and LinkedIn URL (if enriched).',
      'Upload the export — missing LinkedIn can still be resolved from name + company.',
    ],
  },
  {
    id: 'spreadsheet',
    title: 'Google Sheets / Excel',
    steps: [
      'Use the sample CSV below as a header row, or match: company_name, name, linkedin_url, email, website.',
      'One row per contact. LinkedIn URL or email required for each row.',
      'Save as CSV or XLSX and upload.',
    ],
  },
];

/** Columns we recognize beyond the canonical header names (shown in UI hints). */
export const LEAD_IMPORT_COLUMN_ALIASES = [
  'company / organization / account',
  'name / contact / first name',
  'linkedin / person linkedin url / profile',
  'email / title / role / website',
];

export function downloadLeadImportSample(filename = 'dispatch-leads-sample.csv'): void {
  const blob = new Blob([LEAD_IMPORT_SAMPLE_CSV], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
