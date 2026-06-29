export {
  UNIPILE_SAFETY_REFERENCE,
  DEFAULT_SAFETY_SETTINGS,
  channelToLimitKey,
  isWithinWorkingHours,
  computeRequiredCooldownMs,
  type SignalSafetySettings,
  type OutreachAuditAction,
} from '@/lib/signals/safety/limits';
export { getSafetySettings, updateSafetySettings } from '@/lib/signals/safety/settings';
export { logSignalAudit, countAuditActions } from '@/lib/signals/safety/audit';
export {
  assertOutreachAllowed,
  assertAutoSendAllowed,
  getSafetyStatus,
  shouldPollSource,
  sleep,
  type OutreachGuardResult,
  type SafetyStatusSnapshot,
} from '@/lib/signals/safety/guard';
