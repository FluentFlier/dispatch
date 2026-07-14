'use client';

import { useLeadsController } from './useLeadsController';
import { LeadsFeedBody } from './LeadsFeedBody';

/**
 * Unified leads feed page. One inbox that renders both live signal events and
 * directory companies in a single list, reusing the directory detail/draft
 * panel when a directory card is opened. All state, data loading, and actions
 * live in `useLeadsController`; `LeadsFeedBody` owns the presentation.
 */
export default function LeadsPage() {
  const controller = useLeadsController();
  return <LeadsFeedBody {...controller} />;
}
