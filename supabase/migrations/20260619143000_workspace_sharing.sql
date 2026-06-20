create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  kind text not null default 'project',
  autonomy_mode text not null default 'semi',
  default_model_id text,
  enabled_skill_ids jsonb not null default '[]'::jsonb,
  required_connection_ids jsonb not null default '[]'::jsonb,
  root_paths jsonb not null default '[]'::jsonb,
  workflow_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  from_user_id uuid not null references auth.users(id),
  to_email text not null,
  to_user_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  token text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);
create index if not exists workspace_members_workspace_id_idx on public.workspace_members(workspace_id);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists workspace_transfer_requests_workspace_id_idx on public.workspace_transfer_requests(workspace_id);
create index if not exists workspace_transfer_requests_to_user_id_idx on public.workspace_transfer_requests(to_user_id);
create index if not exists workspace_transfer_requests_status_idx on public.workspace_transfer_requests(status);
create unique index if not exists workspace_transfer_pending_email_idx
on public.workspace_transfer_requests(workspace_id, lower(to_email))
where status = 'pending';

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_transfer_requests enable row level security;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_workspaces_updated_at on public.workspaces;
create trigger set_workspaces_updated_at
before update on public.workspaces
for each row
execute function private.set_updated_at();

create or replace function private.workspace_role(workspace uuid, uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when w.owner_id = uid then 'owner'
    else (
      select wm.role
      from public.workspace_members wm
      where wm.workspace_id = workspace
        and wm.user_id = uid
      limit 1
    )
  end
  from public.workspaces w
  where w.id = workspace;
$$;

create or replace function private.can_read_workspace(workspace uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(private.workspace_role(workspace, uid) in ('owner', 'editor', 'viewer'), false);
$$;

create or replace function private.ensure_workspace_owner_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.workspace_members(workspace_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (workspace_id, user_id)
  do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists ensure_workspace_owner_member on public.workspaces;
create trigger ensure_workspace_owner_member
after insert or update of owner_id on public.workspaces
for each row
execute function private.ensure_workspace_owner_member();

create or replace function private.prevent_direct_workspace_owner_change()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if old.owner_id is distinct from new.owner_id and current_user in ('anon', 'authenticated') then
    raise exception 'owner_id can only change through ownership transfer' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_direct_workspace_owner_change on public.workspaces;
create trigger prevent_direct_workspace_owner_change
before update of owner_id on public.workspaces
for each row
execute function private.prevent_direct_workspace_owner_change();

create or replace function private.create_workspace_transfer(target_workspace uuid, target_email text)
returns public.workspace_transfer_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  normalized_email text := lower(trim(target_email));
  target auth.users%rowtype;
  created public.workspace_transfer_requests;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if normalized_email = '' or position('@' in normalized_email) = 0 then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  if private.workspace_role(target_workspace, caller) <> 'owner' then
    raise exception 'only the owner can transfer this workspace' using errcode = '42501';
  end if;

  select * into target
  from auth.users
  where lower(email) = normalized_email
  limit 1;

  insert into public.workspace_transfer_requests (
    workspace_id,
    from_user_id,
    to_email,
    to_user_id,
    token,
    expires_at
  )
  values (
    target_workspace,
    caller,
    normalized_email,
    target.id,
    encode(gen_random_bytes(24), 'hex'),
    now() + interval '14 days'
  )
  on conflict (workspace_id, (lower(to_email))) where status = 'pending'
  do update set
    from_user_id = excluded.from_user_id,
    to_user_id = excluded.to_user_id,
    token = excluded.token,
    expires_at = excluded.expires_at,
    created_at = now(),
    responded_at = null
  returning * into created;

  return created;
end;
$$;

create or replace function public.create_workspace_transfer(workspace_id uuid, to_email text)
returns public.workspace_transfer_requests
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.create_workspace_transfer(workspace_id, to_email);
$$;

create or replace function private.accept_workspace_transfer(request_id uuid, previous_owner_role text default 'viewer')
returns public.workspaces
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  req public.workspace_transfer_requests%rowtype;
  updated_workspace public.workspaces%rowtype;
  old_owner uuid;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if previous_owner_role not in ('viewer', 'editor', 'none') then
    raise exception 'invalid previous owner role' using errcode = '22023';
  end if;

  select * into req
  from public.workspace_transfer_requests
  where id = request_id
  for update;

  if not found or req.status <> 'pending' then
    raise exception 'transfer request is not pending' using errcode = '22023';
  end if;

  if req.expires_at <= now() then
    update public.workspace_transfer_requests
    set status = 'expired', responded_at = now()
    where id = req.id;
    raise exception 'transfer request expired' using errcode = '22023';
  end if;

  if not (
    req.to_user_id = caller
    or lower(req.to_email) = caller_email
  ) then
    raise exception 'not authorized for this transfer' using errcode = '42501';
  end if;

  select owner_id into old_owner
  from public.workspaces
  where id = req.workspace_id
  for update;

  update public.workspaces
  set owner_id = caller
  where id = req.workspace_id
  returning * into updated_workspace;

  insert into public.workspace_members(workspace_id, user_id, role)
  values (req.workspace_id, caller, 'owner')
  on conflict (workspace_id, user_id)
  do update set role = 'owner';

  if old_owner is not null and old_owner <> caller then
    if previous_owner_role = 'none' then
      delete from public.workspace_members
      where workspace_id = req.workspace_id
        and user_id = old_owner;
    else
      insert into public.workspace_members(workspace_id, user_id, role)
      values (req.workspace_id, old_owner, previous_owner_role)
      on conflict (workspace_id, user_id)
      do update set role = excluded.role;
    end if;
  end if;

  update public.workspace_transfer_requests
  set status = 'accepted',
      to_user_id = caller,
      responded_at = now()
  where id = req.id;

  return updated_workspace;
end;
$$;

create or replace function public.accept_workspace_transfer(request_id uuid, previous_owner_role text default 'viewer')
returns public.workspaces
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.accept_workspace_transfer(request_id, previous_owner_role);
$$;

create or replace function private.decline_workspace_transfer(request_id uuid)
returns public.workspace_transfer_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  req public.workspace_transfer_requests%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into req
  from public.workspace_transfer_requests
  where id = request_id
  for update;

  if not found or req.status <> 'pending' then
    raise exception 'transfer request is not pending' using errcode = '22023';
  end if;

  if not (req.to_user_id = caller or lower(req.to_email) = caller_email) then
    raise exception 'not authorized for this transfer' using errcode = '42501';
  end if;

  update public.workspace_transfer_requests
  set status = 'declined',
      to_user_id = coalesce(to_user_id, caller),
      responded_at = now()
  where id = request_id
  returning * into req;

  return req;
end;
$$;

create or replace function public.decline_workspace_transfer(request_id uuid)
returns public.workspace_transfer_requests
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.decline_workspace_transfer(request_id);
$$;

create or replace function private.cancel_workspace_transfer(request_id uuid)
returns public.workspace_transfer_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller uuid := auth.uid();
  req public.workspace_transfer_requests%rowtype;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into req
  from public.workspace_transfer_requests
  where id = request_id
  for update;

  if not found or req.status <> 'pending' then
    raise exception 'transfer request is not pending' using errcode = '22023';
  end if;

  if req.from_user_id <> caller and private.workspace_role(req.workspace_id, caller) <> 'owner' then
    raise exception 'not authorized for this transfer' using errcode = '42501';
  end if;

  update public.workspace_transfer_requests
  set status = 'cancelled',
      responded_at = now()
  where id = request_id
  returning * into req;

  return req;
end;
$$;

create or replace function public.cancel_workspace_transfer(request_id uuid)
returns public.workspace_transfer_requests
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.cancel_workspace_transfer(request_id);
$$;

drop policy if exists "Workspace members can read workspaces" on public.workspaces;
create policy "Workspace members can read workspaces"
on public.workspaces
for select
to authenticated
using (auth.uid() is not null and private.can_read_workspace(id, auth.uid()));

drop policy if exists "Users can create owned workspaces" on public.workspaces;
create policy "Users can create owned workspaces"
on public.workspaces
for insert
to authenticated
with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists "Owners and editors can update workspace definitions" on public.workspaces;
create policy "Owners and editors can update workspace definitions"
on public.workspaces
for update
to authenticated
using (private.workspace_role(id, auth.uid()) in ('owner', 'editor'))
with check (private.workspace_role(id, auth.uid()) in ('owner', 'editor'));

drop policy if exists "Owners can delete workspaces" on public.workspaces;
create policy "Owners can delete workspaces"
on public.workspaces
for delete
to authenticated
using (private.workspace_role(id, auth.uid()) = 'owner');

drop policy if exists "Workspace members can read membership" on public.workspace_members;
create policy "Workspace members can read membership"
on public.workspace_members
for select
to authenticated
using (private.can_read_workspace(workspace_id, auth.uid()));

drop policy if exists "Workspace owners can manage membership" on public.workspace_members;
create policy "Workspace owners can manage membership"
on public.workspace_members
for all
to authenticated
using (private.workspace_role(workspace_id, auth.uid()) = 'owner')
with check (private.workspace_role(workspace_id, auth.uid()) = 'owner');

drop policy if exists "Owners and recipients can read transfer requests" on public.workspace_transfer_requests;
create policy "Owners and recipients can read transfer requests"
on public.workspace_transfer_requests
for select
to authenticated
using (
  auth.uid() is not null
  and (
    from_user_id = auth.uid()
    or to_user_id = auth.uid()
    or lower(to_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or private.workspace_role(workspace_id, auth.uid()) = 'owner'
  )
);

revoke all on public.workspaces from public, anon, authenticated;
revoke all on public.workspace_members from public, anon, authenticated;
revoke all on public.workspace_transfer_requests from public, anon, authenticated;

grant select, insert, update, delete on public.workspaces to authenticated;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant select on public.workspace_transfer_requests to authenticated;
grant all on public.workspaces to service_role;
grant all on public.workspace_members to service_role;
grant all on public.workspace_transfer_requests to service_role;

revoke all on function private.workspace_role(uuid, uuid) from public, anon, authenticated;
revoke all on function private.can_read_workspace(uuid, uuid) from public, anon, authenticated;
revoke all on function private.create_workspace_transfer(uuid, text) from public, anon, authenticated;
revoke all on function private.accept_workspace_transfer(uuid, text) from public, anon, authenticated;
revoke all on function private.decline_workspace_transfer(uuid) from public, anon, authenticated;
revoke all on function private.cancel_workspace_transfer(uuid) from public, anon, authenticated;

grant execute on function private.workspace_role(uuid, uuid) to authenticated;
grant execute on function private.can_read_workspace(uuid, uuid) to authenticated;
grant execute on function private.create_workspace_transfer(uuid, text) to authenticated;
grant execute on function private.accept_workspace_transfer(uuid, text) to authenticated;
grant execute on function private.decline_workspace_transfer(uuid) to authenticated;
grant execute on function private.cancel_workspace_transfer(uuid) to authenticated;

grant execute on function public.create_workspace_transfer(uuid, text) to authenticated;
grant execute on function public.accept_workspace_transfer(uuid, text) to authenticated;
grant execute on function public.decline_workspace_transfer(uuid) to authenticated;
grant execute on function public.cancel_workspace_transfer(uuid) to authenticated;
