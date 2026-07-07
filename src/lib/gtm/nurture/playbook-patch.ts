import type { LeadPlaybook } from '@/lib/signals/types';

/**
 * Two ways the client PATCHes a lead's nurture plan:
 *  - a single-step status toggle (the living checklist), or
 *  - a free-text edit of the plan (why / angle / step labels).
 */
export type PlaybookPatch =
  | { stepIndex: number; status: 'pending' | 'done' | 'skipped' }
  | { edit: { whyThem?: string; angle?: string; stepLabels?: string[] } };

/**
 * Apply a patch to a playbook, returning the next playbook or an error. Pure so
 * the merge (esp. the WS1.2 free-text edit) is unit-testable without the route.
 * Step labels are matched positionally so each step keeps its type/status/timing.
 */
export function applyPlaybookPatch(
  playbook: LeadPlaybook,
  patch: PlaybookPatch,
): { ok: true; playbook: LeadPlaybook } | { ok: false; error: string } {
  if ('edit' in patch) {
    const { whyThem, angle, stepLabels } = patch.edit;
    const steps = stepLabels
      ? playbook.steps.map((s, i) => (i < stepLabels.length ? { ...s, label: stepLabels[i] } : s))
      : playbook.steps;
    return {
      ok: true,
      playbook: {
        ...playbook,
        whyThem: whyThem ?? playbook.whyThem,
        angle: angle ?? playbook.angle,
        steps,
      },
    };
  }

  if (patch.stepIndex >= playbook.steps.length) {
    return { ok: false, error: 'No such playbook step' };
  }
  const steps = playbook.steps.map((s, i) =>
    i === patch.stepIndex ? { ...s, status: patch.status } : s,
  );
  return { ok: true, playbook: { ...playbook, steps } };
}
