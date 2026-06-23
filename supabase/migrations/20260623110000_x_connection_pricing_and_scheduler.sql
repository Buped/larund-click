-- Larund X connection: configurable pricing, usage transparency, dedup cache,
-- and Larund-managed scheduled posts. X has no native scheduled-post endpoint;
-- workers send pending rows via POST /2/tweets at scheduled_for.

create table if not exists public.x_api_pricing (
  operation_code text primary key,
  description text not null,
  usd_cost_per_unit numeric(12, 6) not null default 0,
  markup_multiplier numeric(12, 4) not null default 10,
  uc_cost_per_unit numeric(12, 4)
    generated always as (usd_cost_per_unit * 100 * markup_multiplier) stored,
  last_verified_at date,
  is_active boolean not null default true,
  notes text,
  updated_at timestamptz not null default now()
);

create table if not exists public.x_api_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  operation_code text not null references public.x_api_pricing(operation_code),
  unit_count integer not null default 1 check (unit_count >= 0),
  uc_deducted numeric(12, 4) not null default 0,
  success boolean not null default false,
  related_post_id text,
  related_user_id text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_x_api_usage_log_user_created
  on public.x_api_usage_log(user_id, created_at desc);

create table if not exists public.x_api_dedup_cache (
  user_id uuid not null,
  cache_key text not null,
  operation_code text not null references public.x_api_pricing(operation_code),
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  payload jsonb,
  primary key (user_id, cache_key)
);

create index if not exists idx_x_api_dedup_cache_expires
  on public.x_api_dedup_cache(expires_at);

create table if not exists public.scheduled_x_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  x_account_id text,
  content text not null,
  media_refs jsonb not null default '[]'::jsonb,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'cancelled')),
  linked_chat_session_id text,
  x_post_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_x_posts_due
  on public.scheduled_x_posts(status, scheduled_for)
  where status = 'pending';

create index if not exists idx_scheduled_x_posts_user_created
  on public.scheduled_x_posts(user_id, created_at desc);

insert into public.x_api_pricing
  (operation_code, description, usd_cost_per_unit, markup_multiplier, last_verified_at, is_active, notes)
values
  ('owned_read', 'Connected account owned read: own posts/bookmarks/lists', 0.001, 10, date '2026-06-23', true, 'Verify in X Developer Console before production launch.'),
  ('post_read', 'Public post search/read', 0.005, 10, date '2026-06-23', true, 'Verify in X Developer Console before production launch.'),
  ('user_read', 'Public user/profile read', 0.010, 10, date '2026-06-23', true, 'Verify in X Developer Console before production launch.'),
  ('post_create_standard', 'Create a post without URL', 0.015, 10, date '2026-06-23', true, 'Approval-gated.'),
  ('post_create_with_url', 'Create a post containing a URL', 0.200, 10, date '2026-06-23', true, 'High-cost confirmation required.'),
  ('media_upload', 'Media upload marker; billed through post create where applicable', 0, 1, date '2026-06-23', true, 'Kept for operation labeling.')
on conflict (operation_code) do update set
  description = excluded.description,
  usd_cost_per_unit = excluded.usd_cost_per_unit,
  markup_multiplier = excluded.markup_multiplier,
  last_verified_at = excluded.last_verified_at,
  is_active = excluded.is_active,
  notes = excluded.notes,
  updated_at = now();
