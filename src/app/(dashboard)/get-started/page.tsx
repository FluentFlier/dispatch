import { redirect } from 'next/navigation';

/** Legacy funnel step — trial now auto-starts at /auth/continue. */
export default function GetStartedRedirectPage() {
  redirect('/auth/continue');
}
