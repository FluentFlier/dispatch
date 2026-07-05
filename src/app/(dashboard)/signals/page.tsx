import { redirect } from 'next/navigation';

/**
 * The standalone Signals page has been folded into the unified `/leads` surface:
 * the events feed is now part of the leads Feed view and all signal configuration
 * lives in the leads Setup view. This route only redirects so old links and any
 * bookmarks keep working. The `/api/signals/*` backend routes are unchanged.
 */
export default function SignalsPage(): never {
  redirect('/leads');
}
