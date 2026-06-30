-- Larund Credit Engine — RECOVERY migration.
--
-- The original 20260623170000_credit_engine_oc_uc_cc.sql never reached production:
--   * credit_packages was never created
--   * deduct_larund_credits / the credit_package_profitability view never existed
--   * credit_transactions already existed with an OLDER schema (feature/model_id/
--     cc_cost/...), so the original `create table if not exists` was a no-op and the
--     new columns were never added.
--
-- This migration starts from the ACTUAL current production state: it creates the
-- missing objects and ADDS the missing columns to credit_transactions without
-- touching the 433 historical rows or any legacy column.
--
-- OC (visible output credits) = UC * 10
-- UC (internal usage credits) = real USD cost * 1.2
-- real USD cost = OC / 12

-- 1. credit_packages (absent in prod) ----------------------------------------
create table if not exists public.credit_packages (
  package_code text primary key,
  display_name text not null,
  monthly_price_usd numeric(12, 2) not null default 0,
  monthly_oc_allowance numeric(12, 4) not null,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.credit_packages
  (package_code, display_name, monthly_price_usd, monthly_oc_allowance, is_active)
values
  ('free', 'Free', 0, 25, true),
  ('pro', 'Pro', 29, 300, true),
  ('max', 'Max', 99, 1000, true)
on conflict (package_code) do update set
  display_name = excluded.display_name,
  monthly_price_usd = excluded.monthly_price_usd,
  monthly_oc_allowance = excluded.monthly_oc_allowance,
  is_active = excluded.is_active,
  updated_at = now();

alter table public.credit_packages enable row level security;

drop policy if exists credit_packages_select_all on public.credit_packages;
create policy credit_packages_select_all
  on public.credit_packages
  for select
  to authenticated
  using (true);

drop policy if exists credit_packages_service_all on public.credit_packages;
create policy credit_packages_service_all
  on public.credit_packages
  for all
  to service_role
  using (true)
  with check (true);

-- 2. credit_transactions — extend in place, preserve legacy data --------------
alter table public.credit_transactions add column if not exists source text;
alter table public.credit_transactions add column if not exists usd_cost numeric(18, 6) not null default 0;
alter table public.credit_transactions add column if not exists uc_amount numeric(18, 4) not null default 0;
alter table public.credit_transactions add column if not exists oc_amount numeric(18, 4) not null default 0;
alter table public.credit_transactions add column if not exists related_entity_id text;
alter table public.credit_transactions add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Legacy `feature` is NOT NULL with no default; new-shape inserts omit it, so give
-- it a default to keep those inserts valid (do NOT drop/rename any legacy column).
alter table public.credit_transactions alter column feature set default '';

create index if not exists idx_credit_transactions_user_created
  on public.credit_transactions(user_id, created_at desc);

create index if not exists idx_credit_transactions_source_created
  on public.credit_transactions(source, created_at desc);

-- 3. Canonical deduction function --------------------------------------------
create or replace function public.deduct_larund_credits(
  p_user_id uuid,
  p_usd_cost numeric,
  p_uc_amount numeric,
  p_oc_amount numeric,
  p_source text,
  p_related_entity_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.user_credits
     set uc_balance = greatest(0, uc_balance - p_uc_amount),
         updated_at = now()
   where user_id = p_user_id;

  insert into public.credit_transactions
    (user_id, source, usd_cost, uc_amount, oc_amount, related_entity_id, metadata,
     feature, model_id, cc_cost)
  values
    (p_user_id, p_source, p_usd_cost, p_uc_amount, p_oc_amount, p_related_entity_id,
     coalesce(p_metadata, '{}'::jsonb),
     coalesce(p_source, ''),
     coalesce(p_metadata->>'model', null),
     p_usd_cost);
end;
$$;

-- Only the service role may call this; the security-definer body performs the
-- privileged write to user_credits / credit_transactions.
revoke execute on function public.deduct_larund_credits(uuid, numeric, numeric, numeric, text, text, jsonb) from public;
revoke execute on function public.deduct_larund_credits(uuid, numeric, numeric, numeric, text, text, jsonb) from anon;
revoke execute on function public.deduct_larund_credits(uuid, numeric, numeric, numeric, text, text, jsonb) from authenticated;
grant execute on function public.deduct_larund_credits(uuid, numeric, numeric, numeric, text, text, jsonb) to service_role;

-- 4. Profitability view -------------------------------------------------------
create or replace view public.credit_package_profitability
with (security_invoker = on) as
select
  cp.package_code,
  cp.display_name,
  cp.monthly_price_usd,
  cp.monthly_oc_allowance,
  cp.monthly_oc_allowance / 10.0 as monthly_uc_allowance,
  cp.monthly_oc_allowance / 12.0 as planned_real_usd_cost,
  cp.monthly_price_usd - (cp.monthly_oc_allowance / 12.0) as planned_profit_usd
from public.credit_packages cp
where cp.is_active = true;

-- 5. Self-check: fail loudly if anything did not materialize ------------------
do $$
begin
  if to_regclass('public.credit_packages') is null then
    raise exception 'recovery failed: credit_packages missing';
  end if;
  if to_regprocedure('public.deduct_larund_credits(uuid, numeric, numeric, numeric, text, text, jsonb)') is null then
    raise exception 'recovery failed: deduct_larund_credits missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'credit_transactions' and column_name = 'uc_amount'
  ) then
    raise exception 'recovery failed: credit_transactions.uc_amount missing';
  end if;
end;
$$;
