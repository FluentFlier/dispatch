import type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

function intentSummary(flags: SignalLeadWithContacts['intent_flags']): string | null {
  const parts: string[] = [];
  if (flags?.raised) parts.push('recently raised');
  if (flags?.hiring) parts.push('hiring');
  if (flags?.seeking_investors) parts.push('raising');
  if (flags?.seeking_tools) parts.push('evaluating tools');
  return parts.length ? parts.join(', ') : null;
}

/**
 * Builds a structured nurture playbook from lead + ICP context (no LLM - fast, testable).
 */
export function buildLeadPlaybook(lead: SignalLeadWithContacts): LeadPlaybook {
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const firstName = contact?.name?.split(/\s+/)[0];
  const intent = intentSummary(lead.intent_flags);
  const space =
    Array.isArray(lead.tags) && lead.tags.length ? lead.tags.slice(0, 3).join(', ') : null;

  const whyParts = [
    `${lead.company_name} fits your ICP`,
    lead.batch ? `(${lead.batch})` : null,
    intent ? `- ${intent}` : null,
    space ? `in ${space}` : null,
  ].filter(Boolean);

  const angle =
    lead.tagline?.trim() ||
    (typeof lead.source_fact === 'object' &&
    lead.source_fact &&
    'tagline' in lead.source_fact &&
    typeof (lead.source_fact as { tagline?: string }).tagline === 'string'
      ? (lead.source_fact as { tagline: string }).tagline
      : null) ||
    `Founder building ${space ?? 'in your target market'}`;

  return {
    whyThem: whyParts.join(' '),
    angle,
    hookContext: firstName
      ? `Address ${firstName} by name when you engage.`
      : `Lead with what ${lead.company_name} is building.`,
    steps: [
      {
        type: 'research',
        label: 'Skim their LinkedIn for a recent post or launch',
        dueInDays: 0,
        status: 'pending',
      },
      {
        type: 'comment',
        label: 'Leave a short, value-add comment (no pitch)',
        dueInDays: 1,
        status: 'pending',
      },
      {
        type: 'connect',
        label: firstName
          ? `Connect with ${firstName} - note references what you saw`
          : `Connect - note references their work at ${lead.company_name}`,
        dueInDays: 2,
        status: 'pending',
      },
      {
        type: 'dm',
        label: 'If accepted, light follow-up DM in 5–7 days',
        dueInDays: 7,
        status: 'pending',
      },
    ],
    generatedAt: new Date().toISOString(),
  };
}

/** When the connect step should fire (UTC). */
export function connectDueAt(playbook: LeadPlaybook, from: Date = new Date()): Date {
  const connectStep = playbook.steps.find((s) => s.type === 'connect');
  const days = connectStep?.dueInDays ?? 2;
  const due = new Date(from);
  due.setUTCDate(due.getUTCDate() + days);
  due.setUTCHours(15, 0, 0, 0);
  return due;
}
