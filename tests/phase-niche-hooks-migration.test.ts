/**
 * Phase: Niche Hooks - migration DDL shape guard.
 * We cannot apply SQL in unit tests (no DB), so we assert the migration file
 * contains every table/column/policy/function the later tasks depend on, and
 * that it follows repo conventions (pgvector extension, idempotent policies,
 * service-write + authenticated-read RLS). Applying to a real DB is a manual step.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const sql = readFileSync(
  join(__dirname, '..', 'migrations', '20260711120000_niches-and-hook-arms.sql'),
  'utf8',
).toLowerCase();

describe('niches migration DDL', () => {
  it('enables pgvector', () => {
    expect(sql).toMatch(/create extension if not exists vector/);
  });
  it('creates niches with embedding + status + anti-explosion counters', () => {
    expect(sql).toMatch(/create table if not exists niches/);
    expect(sql).toMatch(/embedding vector\(512\)/);
    expect(sql).toMatch(/active_user_count int/);
    expect(sql).toMatch(/merged_into uuid/);
    expect(sql).toMatch(/last_mined_at timestamptz/);
  });
  it('creates hook_arms with alpha/beta priors and composite PK', () => {
    expect(sql).toMatch(/create table if not exists hook_arms/);
    expect(sql).toMatch(/alpha real not null default 1/);
    expect(sql).toMatch(/beta\s+real not null default 1/);
    expect(sql).toMatch(/primary key \(niche_id, hook_id\)/);
  });
  it('adds all six hook_examples columns', () => {
    for (const col of ['niche_id', 'embedding', 'pattern_class', 'ai_likelihood', 'norm_engagement', 'internal_uses_7d']) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${col}`));
    }
  });
  it('adds niche columns to creator_profile', () => {
    expect(sql).toMatch(/alter table creator_profile add column if not exists niche_id/);
    expect(sql).toMatch(/add column if not exists niche_confidence/);
  });
  it('defines the match_niche_hooks blend function with 17.5d half-life', () => {
    expect(sql).toMatch(/create or replace function match_niche_hooks/);
    expect(sql).toMatch(/17\.5/);
    expect(sql).toMatch(/<=>/); // pgvector cosine distance operator
  });
  it('RLS: service write + authenticated read for each shared table', () => {
    for (const t of ['niches', 'hook_arms']) {
      expect(sql).toMatch(new RegExp(`alter table ${t} enable row level security`));
      expect(sql).toMatch(new RegExp(`for all to project_admin`));
    }
    // authenticated read (logged-in users), never anon
    expect(sql).toMatch(/for select to public using \(auth\.uid\(\) is not null\)/);
  });
  it('is idempotent (guards policy creation)', () => {
    expect(sql).toMatch(/exception when duplicate_object then null/);
  });
});
