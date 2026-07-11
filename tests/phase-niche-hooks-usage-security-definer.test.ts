/**
 * Phase: Niche Hooks - B3 final-review blocker.
 * increment_hook_usage/decrement_hook_uses were invoker-rights functions, but
 * `authenticated` only has SELECT on hook_arms/hook_examples (RLS), so the
 * user-path increment silently no-op'd. We cannot execute SQL in a unit test
 * (no DB), so we assert the migration file makes both functions
 * SECURITY DEFINER with a pinned search_path. Applying + live verification is
 * a manual step (insforge run-raw-sql MCP).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '20260711130000_hook-usage-security-definer.sql'),
  'utf8',
).toLowerCase();

describe('hook-usage-security-definer migration DDL', () => {
  it('redefines increment_hook_usage as SECURITY DEFINER with a pinned search_path', () => {
    const fn = sql.slice(sql.indexOf('create or replace function increment_hook_usage'));
    const body = fn.slice(0, fn.indexOf('$$', fn.indexOf('as $$') + 6));
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public/);
  });
  it('redefines decrement_hook_uses as SECURITY DEFINER with a pinned search_path', () => {
    const fn = sql.slice(sql.indexOf('create or replace function decrement_hook_uses'));
    const body = fn.slice(0, fn.indexOf('$$', fn.indexOf('as $$') + 6));
    expect(body).toMatch(/security definer/);
    expect(body).toMatch(/set search_path = public/);
  });
});
