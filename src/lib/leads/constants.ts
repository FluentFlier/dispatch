/**
 * Shared constants for the leads outreach editors.
 *
 * LinkedIn connect-request notes are capped at 300 characters by the platform;
 * a draft over this ceiling can't be sent. This is the single source of truth
 * shared by every leads draft editor (directory, signal, engager) so the limit
 * can never silently diverge between panels.
 */
export const LINKEDIN_CONNECT_NOTE_LIMIT = 300;
