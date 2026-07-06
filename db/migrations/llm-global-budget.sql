-- ============================================================
-- GLOBAL LLM SPEND BACKSTOP (deployment-wide daily provider-call cap)
-- Backs src/lib/llm-budget.ts. Additive + idempotent — safe to re-run.
--
-- Bounds TOTAL provider chat-completion calls per UTC day across all tenants,
-- independent of per-account (usage_counters) and per-workspace (daily_ai_usage)
-- caps. Active only when the app has env LLM_DAILY_HARD_CAP set.
-- ============================================================

create table if not exists llm_global_usage (
  date       date not null,
  call_count int  not null default 0,
  primary key (date)
);

-- Atomic check-and-increment: the UPDATE ... WHERE call_count < hard_cap RETURNING
-- serializes concurrent callers on the row lock, so parallel provider calls cannot
-- all read the same pre-increment count and all slip past the cap.
create or replace function check_and_increment_global_llm_usage(p_hard_cap int)
returns table(status text, call_count int)
language plpgsql
as $$
declare
  v_count int;
begin
  insert into llm_global_usage (date, call_count)
  values (current_date, 0)
  on conflict (date) do nothing;

  update llm_global_usage
  set call_count = llm_global_usage.call_count + 1
  where llm_global_usage.date = current_date
    and llm_global_usage.call_count < p_hard_cap
  returning llm_global_usage.call_count into v_count;

  if v_count is null then
    select g.call_count into v_count
    from llm_global_usage g
    where g.date = current_date;
    return query select 'blocked'::text, v_count;
  else
    return query select 'ok'::text, v_count;
  end if;
end;
$$;
