import { redirect } from 'next/navigation';

/** Legacy path — trial funnel lives at /get-started. */
export default function BookDemoRedirectPage() {
  redirect('/get-started');
}
