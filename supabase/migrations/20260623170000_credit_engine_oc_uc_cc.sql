-- Larund Credit Engine:
-- OC (visible output credits) = UC * 10
-- UC (internal usage credits) = real USD cost * 1.2
-- real USD cost = OC / 12

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

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source text not null,
  usd_cost numeric(18, 6) not null default 0,
  uc_amount numeric(18, 4) not null default 0,
  oc_amount numeric(18, 4) not null default 0,
  related_entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_transactions_user_created
  on public.credit_transactions(user_id, created_at desc);

create index if not exists idx_credit_transactions_source_created
  on public.credit_transactions(source, created_at desc);

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
as $$
begin
  update public.user_credits
     set uc_balance = greatest(0, uc_balance - p_uc_amount)
   where user_id = p_user_id;

  insert into public.credit_transactions
    (user_id, source, usd_cost, uc_amount, oc_amount, related_entity_id, metadata)
  values
    (p_user_id, p_source, p_usd_cost, p_uc_amount, p_oc_amount, p_related_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create or replace view public.credit_package_profitability as
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
