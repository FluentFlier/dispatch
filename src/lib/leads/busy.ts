/**
 * Per-action busy state for the Leads detail panels.
 *
 * The leads page tracks at most one in-flight action per lead as
 * `{ id, action }`. Every button binds its spinner to its OWN action only, so
 * triggering one (e.g. "Plan outreach") never blanks the others (e.g. "Draft
 * message"). This module holds the pure derivation both the page and the detail
 * components share, so the decoupling is unit-testable without a DOM.
 */

/** Every per-lead / per-signal / per-engager action that can be in flight. */
export type LeadBusyAction =
  | 'draft'
  | 'plan'
  | 'approve'
  | 'email'
  | 'dismiss'
  | 'snooze'
  | 'resolve'
  | 'check'
  | 'followup'
  | 'reply'
  | 'send'
  // Engager (post-engager) detail panel actions.
  | 'connect'
  | 'dm';

/** The single in-flight action for a given lead id, or null when idle. */
export interface LeadBusy {
  id: string;
  action: LeadBusyAction;
}

/** Actions surfaced by the directory-lead detail panel (never 'send'). */
export type LeadDetailAction = Exclude<LeadBusyAction, 'send'>;

/** Actions surfaced by the signal detail panel. */
export type SignalDetailAction = 'draft' | 'send';

/**
 * Returns the action in flight for `id`, or null. Only the lead that owns the
 * in-flight action reports busy; every other lead is idle.
 */
export function busyActionFor(busy: LeadBusy | null, id: string): LeadBusyAction | null {
  return busy && busy.id === id ? busy.action : null;
}

/** Per-button busy flags for the directory-lead detail panel. */
export interface LeadButtonBusy {
  draftBusy: boolean;
  planBusy: boolean;
  approveBusy: boolean;
  resolveBusy: boolean;
  followupBusy: boolean;
  checkBusy: boolean;
  replyBusy: boolean;
  /** True while ANY action runs; gates send/email to dismiss to avoid double-submit. */
  anyBusy: boolean;
}

/** Derive the directory-lead button flags from the single in-flight action. */
export function leadButtonBusy(action: LeadDetailAction | null): LeadButtonBusy {
  return {
    draftBusy: action === 'draft',
    planBusy: action === 'plan',
    approveBusy: action === 'approve' || action === 'reply',
    resolveBusy: action === 'resolve',
    followupBusy: action === 'followup',
    checkBusy: action === 'check',
    replyBusy: action === 'reply',
    anyBusy: action !== null,
  };
}

/** Per-button busy flags for the signal detail panel. */
export interface SignalButtonBusy {
  draftBusy: boolean;
  sendBusy: boolean;
  anyBusy: boolean;
}

/** Derive the signal-panel button flags from the single in-flight action. */
export function signalButtonBusy(action: SignalDetailAction | null): SignalButtonBusy {
  return {
    draftBusy: action === 'draft',
    sendBusy: action === 'send',
    anyBusy: action !== null,
  };
}
