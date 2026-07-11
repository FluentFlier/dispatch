import { describe, it, expect } from 'vitest';
import {
  isMissingRelationError,
  isSchemaMismatchError,
  checkCoreSchemaSetup,
} from '@/lib/db/setup-gate';

describe('setup-gate isMissingRelationError', () => {
  it('detects Postgres 42P01', () => {
    expect(isMissingRelationError({ code: '42P01', message: 'relation "x" does not exist' })).toBe(
      true,
    );
  });

  it('detects PostgREST PGRST205', () => {
    expect(
      isMissingRelationError({ code: 'PGRST205', message: 'Could not find the table in schema cache' }),
    ).toBe(true);
  });

  it('detects message-only missing relation', () => {
    expect(isMissingRelationError(new Error('relation "signal_leads" does not exist'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isMissingRelationError(new Error('permission denied'))).toBe(false);
    expect(isMissingRelationError({ code: '42501', message: 'permission denied' })).toBe(false);
  });

  it('does not treat missing-column as missing relation', () => {
    expect(
      isMissingRelationError({ code: '42703', message: 'column "key" does not exist' }),
    ).toBe(false);
  });
});

describe('setup-gate isSchemaMismatchError', () => {
  it('detects Postgres 42703', () => {
    expect(isSchemaMismatchError({ code: '42703', message: 'column "key" does not exist' })).toBe(
      true,
    );
  });

  it('detects PostgREST PGRST204', () => {
    expect(
      isSchemaMismatchError({
        code: 'PGRST204',
        message: 'Could not find the key column of user_settings in the schema cache',
      }),
    ).toBe(true);
  });

  it('detects message-only missing column', () => {
    expect(isSchemaMismatchError(new Error('column "key" of relation "user_settings" does not exist'))).toBe(
      true,
    );
  });

  it('ignores missing-relation errors', () => {
    expect(isSchemaMismatchError({ code: '42P01', message: 'relation "posts" does not exist' })).toBe(
      false,
    );
  });
});

function mockClient(tableErrors: Record<string, { code: string; message: string } | null>) {
  return {
    database: {
      from(table: string) {
        return {
          select() {
            return {
              limit() {
                const error = tableErrors[table] ?? null;
                return Promise.resolve({ data: error ? null : [], error });
              },
            };
          },
        };
      },
    },
  };
}

describe('setup-gate checkCoreSchemaSetup', () => {
  it('returns ok when all core tables probe cleanly', async () => {
    const client = mockClient({});
    const result = await checkCoreSchemaSetup(client as never);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('reports missing posts and workspaces', async () => {
    const client = mockClient({
      posts: { code: '42P01', message: 'relation "posts" does not exist' },
      workspaces: { code: 'PGRST205', message: 'Could not find the table in schema cache' },
    });
    const result = await checkCoreSchemaSetup(client as never);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('posts');
    expect(result.missing).toContain('workspaces');
  });

  it('treats wrong-shape user_settings (missing key column) as setup failure', async () => {
    const client = mockClient({
      user_settings: { code: '42703', message: 'column "key" does not exist' },
    });
    const result = await checkCoreSchemaSetup(client as never);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('user_settings');
  });
});
