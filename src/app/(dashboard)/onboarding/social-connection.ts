import type { ConnectedAccount } from './steps/StepConnect';

export const SOCIAL_ACCOUNT_SNAPSHOT_KEY = 'onboarding-social-account-ids';

/** Returns the account created by the hosted flow, without mistaking an older connection for success. */
export function findNewConnectedAccount(
  accounts: ConnectedAccount[],
  previousIds: Set<string> | null,
): ConnectedAccount | null {
  if (previousIds === null) return accounts[0] ?? null;
  return accounts.find(
    (account) =>
      Boolean(account.unipile_account_id) && !previousIds.has(account.unipile_account_id as string),
  ) ?? null;
}
