create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create table if not exists public.larund_skills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version text not null default '1.0.0',
  description text not null default '',
  source text not null check (source in ('admin_authored', 'self_learned', 'user', 'workspace', 'imported', 'suggested')),
  status text not null default 'pending_review' check (status in ('draft', 'pending_review', 'validated_local', 'approved', 'deprecated', 'blocked')),
  risk_level text not null,
  allowed_tools text[] not null default array[]::text[],
  required_connections text[] not null default array[]::text[],
  required_mcp_servers text[] not null default array[]::text[],
  manifest_json jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.larund_projects(id) on delete cascade,
  checksum text not null,
  origin_automation_id text,
  origin_task_run_id text,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.larund_skill_versions (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.larund_skills(id) on delete cascade,
  version text not null,
  manifest_json jsonb not null,
  checksum text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (skill_id, version)
);

create table if not exists public.larund_skill_review_events (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.larund_skills(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('created', 'submitted', 'approved', 'blocked', 'deprecated', 'validation_recorded')),
  from_status text,
  to_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.larund_skill_validation_runs (
  id uuid primary key default gen_random_uuid(),
  skill_id uuid not null references public.larund_skills(id) on delete cascade,
  task_run_id text not null,
  outcome text not null check (outcome in ('success', 'failed', 'blocked')),
  user_confirmed boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (skill_id, task_run_id)
);

create unique index if not exists larund_skills_global_name_idx
on public.larund_skills (lower(name))
where workspace_id is null and status not in ('blocked', 'deprecated');

create unique index if not exists larund_skills_workspace_name_idx
on public.larund_skills (workspace_id, lower(name))
where workspace_id is not null and status not in ('blocked', 'deprecated');

create index if not exists larund_skills_status_idx on public.larund_skills(status);
create index if not exists larund_skills_workspace_idx on public.larund_skills(workspace_id);
create index if not exists larund_skill_versions_skill_idx on public.larund_skill_versions(skill_id);
create index if not exists larund_skill_review_events_skill_idx on public.larund_skill_review_events(skill_id, created_at desc);
create index if not exists larund_skill_validation_runs_skill_idx on public.larund_skill_validation_runs(skill_id, created_at desc);

alter table public.larund_skills enable row level security;
alter table public.larund_skill_versions enable row level security;
alter table public.larund_skill_review_events enable row level security;
alter table public.larund_skill_validation_runs enable row level security;

create or replace function private.larund_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_larund_skills_updated_at on public.larund_skills;
create trigger set_larund_skills_updated_at
before update on public.larund_skills
for each row
execute function private.larund_set_updated_at();

create or replace function private.larund_can_read_skill(skill public.larund_skills, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select uid is not null and (
    (skill.workspace_id is null and skill.status = 'approved')
    or private.is_admin(uid)
    or skill.created_by = uid
    or (skill.workspace_id is not null and private.larund_user_owns_project(skill.workspace_id, uid))
  );
$$;

create or replace function private.larund_can_write_skill(skill public.larund_skills, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select uid is not null and (
    private.is_admin(uid)
    or (
      skill.created_by = uid
      and skill.workspace_id is not null
      and private.larund_user_owns_project(skill.workspace_id, uid)
      and skill.status in ('draft', 'pending_review', 'validated_local')
    )
  );
$$;

drop policy if exists "Users can read shared Larund skills" on public.larund_skills;
create policy "Users can read shared Larund skills"
on public.larund_skills
for select
to authenticated
using (private.larund_can_read_skill(larund_skills, auth.uid()));

drop policy if exists "Users can submit workspace Larund skills" on public.larund_skills;
create policy "Users can submit workspace Larund skills"
on public.larund_skills
for insert
to authenticated
with check (
  created_by = auth.uid()
  and (
    private.is_admin(auth.uid())
    or (
      workspace_id is not null
      and private.larund_user_owns_project(workspace_id, auth.uid())
      and status in ('draft', 'pending_review', 'validated_local', 'approved')
    )
  )
);

drop policy if exists "Users can update own pending Larund skills" on public.larund_skills;
create policy "Users can update own pending Larund skills"
on public.larund_skills
for update
to authenticated
using (private.larund_can_write_skill(larund_skills, auth.uid()))
with check (private.larund_can_write_skill(larund_skills, auth.uid()));

drop policy if exists "Users can read Larund skill versions" on public.larund_skill_versions;
create policy "Users can read Larund skill versions"
on public.larund_skill_versions
for select
to authenticated
using (
  exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_versions.skill_id
      and private.larund_can_read_skill(s, auth.uid())
  )
);

drop policy if exists "Users can create Larund skill versions" on public.larund_skill_versions;
create policy "Users can create Larund skill versions"
on public.larund_skill_versions
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_versions.skill_id
      and private.larund_can_write_skill(s, auth.uid())
  )
);

drop policy if exists "Users can read Larund skill review events" on public.larund_skill_review_events;
create policy "Users can read Larund skill review events"
on public.larund_skill_review_events
for select
to authenticated
using (
  exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_review_events.skill_id
      and private.larund_can_read_skill(s, auth.uid())
  )
);

drop policy if exists "Users can create Larund skill review events" on public.larund_skill_review_events;
create policy "Users can create Larund skill review events"
on public.larund_skill_review_events
for insert
to authenticated
with check (
  actor_user_id = auth.uid()
  and exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_review_events.skill_id
      and private.larund_can_write_skill(s, auth.uid())
  )
);

drop policy if exists "Users can read Larund skill validation runs" on public.larund_skill_validation_runs;
create policy "Users can read Larund skill validation runs"
on public.larund_skill_validation_runs
for select
to authenticated
using (
  exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_validation_runs.skill_id
      and private.larund_can_read_skill(s, auth.uid())
  )
);

drop policy if exists "Users can create Larund skill validation runs" on public.larund_skill_validation_runs;
create policy "Users can create Larund skill validation runs"
on public.larund_skill_validation_runs
for insert
to authenticated
with check (
  created_by = auth.uid()
  and exists (
    select 1 from public.larund_skills s
    where s.id = larund_skill_validation_runs.skill_id
      and private.larund_can_write_skill(s, auth.uid())
  )
);

create or replace function private.approve_larund_skill(target_skill_id uuid, make_global boolean default false)
returns public.larund_skills
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  before_status text;
  updated public.larund_skills;
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select status into before_status from public.larund_skills where id = target_skill_id for update;
  if before_status is null then
    raise exception 'skill not found' using errcode = 'P0002';
  end if;

  update public.larund_skills
  set status = 'approved',
      workspace_id = case when make_global then null else workspace_id end,
      approved_by = auth.uid(),
      approved_at = now(),
      blocked_reason = null
  where id = target_skill_id
  returning * into updated;

  insert into public.larund_skill_review_events(skill_id, actor_user_id, action, from_status, to_status, metadata)
  values (target_skill_id, auth.uid(), 'approved', before_status, 'approved', jsonb_build_object('makeGlobal', make_global));

  return updated;
end;
$$;

create or replace function public.approve_larund_skill(skill_id uuid, make_global boolean default false)
returns public.larund_skills
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.approve_larund_skill(skill_id, make_global);
$$;

create or replace function private.block_larund_skill(target_skill_id uuid, reason text default null)
returns public.larund_skills
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  before_status text;
  updated public.larund_skills;
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select status into before_status from public.larund_skills where id = target_skill_id for update;
  update public.larund_skills set status = 'blocked', blocked_reason = reason where id = target_skill_id returning * into updated;
  insert into public.larund_skill_review_events(skill_id, actor_user_id, action, from_status, to_status, reason)
  values (target_skill_id, auth.uid(), 'blocked', before_status, 'blocked', reason);
  return updated;
end;
$$;

create or replace function public.block_larund_skill(skill_id uuid, reason text default null)
returns public.larund_skills
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.block_larund_skill(skill_id, reason);
$$;

create or replace function private.deprecate_larund_skill(target_skill_id uuid, reason text default null)
returns public.larund_skills
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  before_status text;
  updated public.larund_skills;
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select status into before_status from public.larund_skills where id = target_skill_id for update;
  update public.larund_skills set status = 'deprecated', blocked_reason = reason where id = target_skill_id returning * into updated;
  insert into public.larund_skill_review_events(skill_id, actor_user_id, action, from_status, to_status, reason)
  values (target_skill_id, auth.uid(), 'deprecated', before_status, 'deprecated', reason);
  return updated;
end;
$$;

create or replace function public.deprecate_larund_skill(skill_id uuid, reason text default null)
returns public.larund_skills
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.deprecate_larund_skill(skill_id, reason);
$$;

revoke all on public.larund_skills from public, anon, authenticated;
revoke all on public.larund_skill_versions from public, anon, authenticated;
revoke all on public.larund_skill_review_events from public, anon, authenticated;
revoke all on public.larund_skill_validation_runs from public, anon, authenticated;

grant select, insert, update on public.larund_skills to authenticated;
grant select, insert on public.larund_skill_versions to authenticated;
grant select, insert on public.larund_skill_review_events to authenticated;
grant select, insert on public.larund_skill_validation_runs to authenticated;

grant all on public.larund_skills to service_role;
grant all on public.larund_skill_versions to service_role;
grant all on public.larund_skill_review_events to service_role;
grant all on public.larund_skill_validation_runs to service_role;

revoke all on function private.larund_can_read_skill(public.larund_skills, uuid) from public, anon, authenticated;
revoke all on function private.larund_can_write_skill(public.larund_skills, uuid) from public, anon, authenticated;
grant execute on function private.larund_can_read_skill(public.larund_skills, uuid) to authenticated;
grant execute on function private.larund_can_write_skill(public.larund_skills, uuid) to authenticated;

grant execute on function public.approve_larund_skill(uuid, boolean) to authenticated;
grant execute on function public.block_larund_skill(uuid, text) to authenticated;
grant execute on function public.deprecate_larund_skill(uuid, text) to authenticated;
