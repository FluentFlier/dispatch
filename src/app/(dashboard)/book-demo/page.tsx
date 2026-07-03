import { redirect } from 'next/navigation';

/** Legacy path — funnel continues at /auth/continue. */
export default function BookDemoRedirectPage() {
  redirect('/auth/continue');
}
