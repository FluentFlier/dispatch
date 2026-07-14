import { redirect } from 'next/navigation';

/**
 * Lead settings were folded into the Leads → Setup surface (timing, channels,
 * sender identity now live in the Delivery card there) so all lead configuration
 * lives in one place. This route stays as a redirect so old links keep working.
 */
export default function LeadSettingsRedirect() {
  redirect('/leads?view=setup');
}
