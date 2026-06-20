create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create table if not exists public.larund_projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_by_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  description text not null default '',
  kind text not null default 'project',
  status text not null default 'active' check (status in ('active', 'archived')),
  color text default null,
  icon text default 'folder',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz default null,
  last_opened_at timestamptz default null
);

create table if not exists public.larund_user_project_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_project_id uuid references public.larund_projects(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.larund_project_records (
  collection text not null,
  id text not null,
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists idx_larund_projects_owner_user_id on public.larund_projects(owner_user_id);
create index if not exists idx_larund_projects_owner_status on public.larund_projects(owner_user_id, status);
create index if not exists idx_larund_projects_updated_at on public.larund_projects(updated_at desc);
create index if not exists idx_larund_project_records_project on public.larund_project_records(project_id);
create index if not exists idx_larund_project_records_collection_project on public.larund_project_records(collection, project_id);

alter table public.larund_projects enable row level security;
alter table public.larund_user_project_preferences enable row level security;
alter table public.larund_project_records enable row level security;

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

drop trigger if exists set_larund_projects_updated_at on public.larund_projects;
create trigger set_larund_projects_updated_at
before update on public.larund_projects
for each row
execute function private.larund_set_updated_at();

drop trigger if exists set_larund_user_project_preferences_updated_at on public.larund_user_project_preferences;
create trigger set_larund_user_project_preferences_updated_at
before update on public.larund_user_project_preferences
for each row
execute function private.larund_set_updated_at();

drop trigger if exists set_larund_project_records_updated_at on public.larund_project_records;
create trigger set_larund_project_records_updated_at
before update on public.larund_project_records
for each row
execute function private.larund_set_updated_at();

create or replace function private.larund_user_owns_project(project uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.larund_projects
    where id = project
      and owner_user_id = uid
      and status = 'active'
  );
$$;

drop policy if exists "Larund users can read own projects" on public.larund_projects;
create policy "Larund users can read own projects"
on public.larund_projects
for select
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "Larund users can create own projects" on public.larund_projects;
create policy "Larund users can create own projects"
on public.larund_projects
for insert
to authenticated
with check (
  owner_user_id = auth.uid()
  and created_by_user_id = auth.uid()
);

drop policy if exists "Larund users can update own projects" on public.larund_projects;
create policy "Larund users can update own projects"
on public.larund_projects
for update
to authenticated
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Larund users can delete own projects" on public.larund_projects;
create policy "Larund users can delete own projects"
on public.larund_projects
for delete
to authenticated
using (owner_user_id = auth.uid());

drop policy if exists "Larund users can read own project preference" on public.larund_user_project_preferences;
create policy "Larund users can read own project preference"
on public.larund_user_project_preferences
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Larund users can create own project preference" on public.larund_user_project_preferences;
create policy "Larund users can create own project preference"
on public.larund_user_project_preferences
for insert
to authenticated
with check (
  user_id = auth.uid()
  and (
    active_project_id is null
    or private.larund_user_owns_project(active_project_id, auth.uid())
  )
);

drop policy if exists "Larund users can update own project preference" on public.larund_user_project_preferences;
create policy "Larund users can update own project preference"
on public.larund_user_project_preferences
for update
to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (
    active_project_id is null
    or private.larund_user_owns_project(active_project_id, auth.uid())
  )
);

drop policy if exists "Larund users can read project records they own" on public.larund_project_records;
create policy "Larund users can read project records they own"
on public.larund_project_records
for select
to authenticated
using (private.larund_user_owns_project(project_id, auth.uid()));

drop policy if exists "Larund users can write project records they own" on public.larund_project_records;
create policy "Larund users can write project records they own"
on public.larund_project_records
for insert
to authenticated
with check (private.larund_user_owns_project(project_id, auth.uid()));

drop policy if exists "Larund users can update project records they own" on public.larund_project_records;
create policy "Larund users can update project records they own"
on public.larund_project_records
for update
to authenticated
using (private.larund_user_owns_project(project_id, auth.uid()))
with check (private.larund_user_owns_project(project_id, auth.uid()));

drop policy if exists "Larund users can delete project records they own" on public.larund_project_records;
create policy "Larund users can delete project records they own"
on public.larund_project_records
for delete
to authenticated
using (private.larund_user_owns_project(project_id, auth.uid()));

revoke all on public.larund_projects from public, anon, authenticated;
revoke all on public.larund_user_project_preferences from public, anon, authenticated;
revoke all on public.larund_project_records from public, anon, authenticated;

grant select, insert, update, delete on public.larund_projects to authenticated;
grant select, insert, update on public.larund_user_project_preferences to authenticated;
grant select, insert, update, delete on public.larund_project_records to authenticated;

grant all on public.larund_projects to service_role;
grant all on public.larund_user_project_preferences to service_role;
grant all on public.larund_project_records to service_role;

revoke all on function private.larund_user_owns_project(uuid, uuid) from public, anon, authenticated;
grant execute on function private.larund_user_owns_project(uuid, uuid) to authenticated;
