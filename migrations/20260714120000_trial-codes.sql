-- Trial access codes: gate the free trial behind a redeemable code.
--
-- WHY: new users previously auto-started a 7-day Starter trial at /auth/continue.
-- We now require a code (e.g. LINKEDIN) so trials are attributable to a campaign.
-- Each code carries its own trial length and plan tier. Codes are reusable
-- campaign codes (many users per code) with an optional redemption cap and an
-- active toggle; each user may redeem at most one code. Idempotent.

create table if not exists trial_codes (
  code text primary key,
  plan text not null check (plan = any (array['starter', 'growth', 'pro', 'unlimited'])),
  trial_days int not null check (trial_days > 0 and trial_days <= 365),
  active boolean not null default true,
  -- null = unlimited redemptions
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  redemption_count int not null default 0,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists trial_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code text not null references trial_codes (code) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  -- one trial-code redemption per user
  unique (user_id)
);

create index if not exists trial_code_redemptions_code on trial_code_redemptions (code, created_at desc);

alter table trial_codes enable row level security;
alter table trial_code_redemptions enable row level security;

-- Admin/service-role only: codes are managed from the admin dashboard and
-- redeemed by the server (service client). Never exposed to anon/browser reads.
do $$ begin
  create policy trial_codes_admin on trial_codes for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy trial_code_redemptions_admin on trial_code_redemptions for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;

-- Seed the launch campaign code.
insert into trial_codes (code, plan, trial_days, active, note)
values ('LINKEDIN', 'starter', 7, true, 'LinkedIn launch campaign')
on conflict (code) do nothing;
