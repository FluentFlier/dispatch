-- ============================================================
-- SMS DRAFT FLOW (Twilio)
-- Apply on InsForge to enable texting drafts + inbound photo replies.
-- Draft magic-link tokens are stateless (signed HMAC), so no token table is
-- needed — only a mapping from a verified phone number to a user.
-- ============================================================

create table if not exists phone_numbers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  -- E.164 format, e.g. +15551234567
  phone text not null,
  verified boolean not null default false,
  -- Short-lived code used during the verify handshake (nullable once verified).
  verification_code text,
  verification_expires_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id),
  unique(phone)
);

create index if not exists phone_numbers_phone on phone_numbers (phone);

-- Reuse the shared updated_at trigger if present in the base schema.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at') then
    drop trigger if exists phone_numbers_updated_at on phone_numbers;
    create trigger phone_numbers_updated_at
      before update on phone_numbers
      for each row execute function update_updated_at();
  end if;
end $$;

-- Row-level security: a user sees only their own number.
-- (Service-role cron/webhook bypasses RLS.) Aligns with the user_id-based RLS
-- used across the app pending the workspace_id migration.
alter table phone_numbers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'phone_numbers' and policyname = 'phone_numbers_owner'
  ) then
    create policy phone_numbers_owner on phone_numbers
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;
