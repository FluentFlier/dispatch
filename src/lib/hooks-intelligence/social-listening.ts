import { DEFAULT_WATCHLIST } from './watchlist';

/**
 * Social Listening — mines watchlist accounts when Apify is configured,
 * otherwise returns targets for gstack dev scripts (npm run hooks:listen).
 */
export async function runSocialListening(refreshAccounts = 20) {
  const accounts = DEFAULT_WATCHLIST.accounts
    .sort((a, b) => b.priority - a.priority)
    .slice(0, refreshAccounts);

  console.log(`[Hook Intelligence] Social listening on ${accounts.length} accounts...`);

  const apifyReady = Boolean(process.env.APIFY_TOKEN?.trim());
  const useProd =
    apifyReady &&
    (process.env.USE_APIFY === 'true' ||
      process.env.USE_PROD_MINING === 'true' ||
      process.env.NODE_ENV === 'production');

  if (useProd) {
    try {
      const { prodMining } = await import('./prod-mining');
      const mining = await prodMining.scheduledMineForOrg('system');
      return {
        status: 'mined',
        accounts_checked: accounts.length,
        handles: accounts.map((a) => a.handle),
        mining,
      };
    } catch (err) {
      console.warn('[Hook Intelligence] Apify mining failed:', err);
      return {
        status: 'mining_failed',
        accounts_checked: accounts.length,
        handles: accounts.map((a) => a.handle),
        error: err instanceof Error ? err.message : String(err),
        hint: 'Check APIFY_TOKEN or run: npm run hooks:listen',
      };
    }
  }

  return {
    status: 'watchlist_ready',
    accounts_checked: accounts.length,
    handles: accounts.map((a) => a.handle),
    hint: apifyReady
      ? 'Set USE_APIFY=true to enable live Apify mining'
      : 'Set APIFY_TOKEN + USE_APIFY=true, or run: npm run hooks:listen',
  };
}
