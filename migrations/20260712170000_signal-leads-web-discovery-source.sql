-- Expand signal_leads.source for ICP web discovery + future social adapters.
ALTER TABLE signal_leads DROP CONSTRAINT IF EXISTS signal_leads_source_check;
ALTER TABLE signal_leads ADD CONSTRAINT signal_leads_source_check
  CHECK (source IN (
    'web_discovery',
    'yc_directory',
    'yc_launches',
    'product_hunt',
    'linkedin',
    'x',
    'manual'
  ));
