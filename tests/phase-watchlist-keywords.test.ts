/**
 * Phase: workspace watchlist keywords + track endpoint (Task 6)
 *
 * addWatchlistEntry creates up to two signal_sources rows (X account +
 * LinkedIn company page), skips duplicates by handle_or_url, and merges
 * keywords (lowercased + deduped) into signal_directory_settings.custom_keywords.
 * The classifier separately accepts extraKeywords, extending the
 * accelerator_join keyword pack without touching scoring/weights.
 */
import { describe, it, expect } from 'vitest';
import { addWatchlistEntry } from '@/lib/signals/watchlist';
import { classifyPost } from '@/lib/signals/classifier';
import { SIGNAL_LABELS } from '@/lib/signals/notifications/slack-alert';
import { parseTrackIntent } from '@/lib/signals/icp/parse-track-intent';
import type { DirectorySettingsRow, IngestedPost } from '@/lib/signals/types';

type DbCall = { table: string; op: 'select' | 'insert' | 'update'; payload?: unknown };

/**
 * Minimal chainable fake of the InsForge query builder, scoped to what
 * addWatchlistEntry touches: signal_sources (existence check by
 * workspace+handle_or_url, then insert) and signal_directory_settings
 * (select-or-seed via getDirectorySettings, patch via updateDirectorySettings).
 * Stateful so a second call in the same test sees rows the first call created.
 */
function makeClient(initialSettings?: Partial<DirectorySettingsRow>) {
  const calls: DbCall[] = [];
  const existingHandles = new Set<string>();
  let settings: DirectorySettingsRow = {
    workspace_id: 'ws1',
    enabled_sources: [],
    icp_description: null,
    icp_verticals: [],
    icp_keywords: [],
    custom_keywords: [],
    recency_window: 'current_batch',
    digest_run_hour_local: 6,
    digest_timezone: null,
    digest_channels: { today: true, slack: false, email: false },
    digest_top_n: 15,
    sender_identity: null,
    meeting_link: null,
    digest_delivered_at: null,
    created_at: '',
    updated_at: '',
    ...initialSettings,
  };

  const database = {
    from(table: string) {
      let op: DbCall['op'] = 'select';
      let payload: unknown;
      const eqFilters: Record<string, unknown> = {};

      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (col: string, val: unknown) => {
        eqFilters[col] = val;
        return builder;
      };
      builder.limit = () => builder;
      builder.insert = (p: unknown) => {
        op = 'insert';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      };
      builder.update = (p: unknown) => {
        op = 'update';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      };
      builder.single = async () => {
        if (table === 'signal_sources' && op === 'insert') {
          const row = payload as Record<string, unknown>;
          existingHandles.add(String(row.handle_or_url));
          return {
            data: {
              id: `src-${calls.length}`,
              poll_interval_minutes: 30,
              last_polled_at: null,
              cursor_json: null,
              created_at: '',
              updated_at: '',
              ...row,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };

      // Terminal await point for calls that don't chain .single() -
      // signal_sources existence check and signal_directory_settings
      // select/update all resolve here.
      builder.then = (resolve: (v: { data?: unknown; error: unknown }) => unknown) => {
        if (table === 'signal_sources' && op === 'select') {
          const handle = String(eqFilters.handle_or_url ?? '');
          return resolve({ data: existingHandles.has(handle) ? [{ id: 'existing' }] : [], error: null });
        }
        if (table === 'signal_directory_settings' && op === 'select') {
          return resolve({ data: [settings], error: null });
        }
        if (table === 'signal_directory_settings' && op === 'update') {
          settings = { ...settings, ...(payload as Partial<DirectorySettingsRow>) };
          return resolve({ error: null });
        }
        return resolve({ data: null, error: null });
      };

      return builder;
    },
  };

  return {
    client: { database } as unknown as never,
    calls,
    getSettings: () => settings,
  };
}

const WS = 'ws1';

describe('Phase: watchlist keywords - addWatchlistEntry', () => {
  it('creates both an X source and a LinkedIn company_page source', async () => {
    const { client, calls } = makeClient();

    const result = await addWatchlistEntry(client, WS, {
      name: 'Acme Accelerator',
      xHandle: '@acmeaccel',
      linkedinCompanyUrl: 'https://www.linkedin.com/company/acme-accel/',
    });

    expect(result.sourcesCreated).toHaveLength(2);
    const xRow = result.sourcesCreated.find((s) => s.platform === 'x');
    const liRow = result.sourcesCreated.find((s) => s.platform === 'linkedin');
    expect(xRow).toMatchObject({ handle_or_url: 'acmeaccel', source_type: 'account', label: 'Acme Accelerator' });
    expect(liRow).toMatchObject({
      handle_or_url: 'https://www.linkedin.com/company/acme-accel/',
      source_type: 'company_page',
      label: 'Acme Accelerator',
    });

    const inserts = calls.filter((c) => c.table === 'signal_sources' && c.op === 'insert');
    expect(inserts).toHaveLength(2);
  });

  it('dedupes an existing handle: a second call with the same handle creates no duplicate', async () => {
    const { client, calls } = makeClient();

    await addWatchlistEntry(client, WS, { name: 'Acme Accelerator', xHandle: 'acmeaccel' });
    const firstInsertCount = calls.filter((c) => c.table === 'signal_sources' && c.op === 'insert').length;
    expect(firstInsertCount).toBe(1);

    const second = await addWatchlistEntry(client, WS, { name: 'Acme Accelerator (again)', xHandle: 'acmeaccel' });

    const totalInserts = calls.filter((c) => c.table === 'signal_sources' && c.op === 'insert').length;
    expect(totalInserts).toBe(1); // no new insert on the duplicate call
    expect(second.sourcesCreated).toHaveLength(0);
  });

  it('merges keywords lowercased and deduped, and the merge survives a round trip', async () => {
    const { client, getSettings } = makeClient({ custom_keywords: ['seed'] });

    const result = await addWatchlistEntry(client, WS, {
      name: 'Foundry Group',
      keywords: ['YC', 'yc', 'Techstars'],
    });

    expect(result.customKeywords.sort()).toEqual(['seed', 'techstars', 'yc'].sort());
    // Round trip: the fake's persisted settings reflect the same merged list,
    // as a real getDirectorySettings() call after this would return.
    expect(getSettings().custom_keywords.sort()).toEqual(['seed', 'techstars', 'yc'].sort());

    // A follow-up entry appends without dropping or re-duplicating prior keywords.
    const second = await addWatchlistEntry(client, WS, { name: 'Foo', keywords: ['yc', 'newkw'] });
    expect(second.customKeywords.sort()).toEqual(['newkw', 'seed', 'techstars', 'yc'].sort());
  });
});

describe('Phase: watchlist keywords - classifier extraKeywords', () => {
  const basePost: IngestedPost = {
    platform: 'x',
    externalPostId: 'p1',
    authorName: 'Jane Doe',
    content: 'Thrilled to share we just joined the Foundry Fellowship program this week!',
  };

  it('does not match on the default accelerator keyword pack alone', () => {
    expect(classifyPost(basePost)).toBeNull();
  });

  it('accepts extraKeywords and matches a post containing a custom keyword', () => {
    const classified = classifyPost(basePost, ['foundry fellowship']);

    expect(classified).not.toBeNull();
    expect(classified?.signalType).toBe('accelerator_join');
    expect(classified?.matchedKeywords).toContain('foundry fellowship');
  });
});

describe('Phase: field_change slack label', () => {
  it('has a non-empty label for field_change', () => {
    expect(SIGNAL_LABELS.field_change).toBeTruthy();
  });
});

describe('Phase: track chat intent parsing', () => {
  it('parses "track HF0" into a name-only intent', () => {
    expect(parseTrackIntent('track HF0')).toEqual({
      name: 'HF0',
      xHandle: undefined,
      linkedinCompanyUrl: undefined,
    });
  });

  it('parses an x handle and linkedin company url out of a track command', () => {
    const intent = parseTrackIntent(
      'track Speedrun on x @speedrun and linkedin https://linkedin.com/company/speedrun',
    );
    expect(intent).toEqual({
      name: 'Speedrun',
      xHandle: 'speedrun',
      linkedinCompanyUrl: 'https://linkedin.com/company/speedrun',
    });
  });

  it('returns null for a message that is not a track command', () => {
    expect(parseTrackIntent('find leads now')).toBeNull();
  });
});
