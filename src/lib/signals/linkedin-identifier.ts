/** Build a LinkedIn profile URL from signal / post metadata. */
export function linkedInIdentifierFromSignal(input: {
  authorHandle?: string | null;
  personName?: string | null;
}): string {
  const handle = input.authorHandle?.trim();
  if (handle) {
    if (/linkedin\.com/i.test(handle)) return handle;
    const slug = handle.replace(/^@/, '').replace(/^in\//, '');
    return `https://linkedin.com/in/${slug}`;
  }
  const name = input.personName?.trim();
  if (name) {
    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    if (slug) return `https://linkedin.com/in/${slug}`;
  }
  return '';
}
