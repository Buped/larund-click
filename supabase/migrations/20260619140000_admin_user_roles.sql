create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to anon, authenticated;

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'user', 'workflow_builder', 'support', 'owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, role)
);

create index if not exists user_roles_user_id_idx on public.user_roles (user_id);
create index if not exists user_roles_role_idx on public.user_roles (role);

alter table public.user_roles enable row level security;

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

drop trigger if exists set_user_roles_updated_at on public.user_roles;
create trigger set_user_roles_updated_at
before update on public.user_roles
for each row
execute function private.set_updated_at();

create or replace function private.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.user_roles
    where user_id = uid
      and role = 'admin'
  );
$$;

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security invoker
set search_path = pg_catalog, public, private
as $$
  select case
    when uid is null or auth.uid() is null then false
    when uid = auth.uid() then coalesce(private.is_admin(uid), false)
    when private.is_admin(auth.uid()) then coalesce(private.is_admin(uid), false)
    else false
  end;
$$;

create or replace function public.current_user_roles()
returns text[]
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(role order by role), array[]::text[])
  from public.user_roles
  where auth.uid() is not null
    and user_id = auth.uid();
$$;

create or replace function private.admin_set_role(target_user uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_role not in ('admin', 'user', 'workflow_builder', 'support', 'owner') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  insert into public.user_roles (user_id, role)
  values (target_user, target_role)
  on conflict (user_id, role) do nothing;
end;
$$;

create or replace function public.admin_set_role(target_user uuid, target_role text)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.admin_set_role(target_user, target_role);
$$;

create or replace function private.admin_revoke_role(target_user uuid, target_role text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if target_role not in ('admin', 'user', 'workflow_builder', 'support', 'owner') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  delete from public.user_roles
  where user_id = target_user
    and role = target_role;
end;
$$;

create or replace function public.admin_revoke_role(target_user uuid, target_role text)
returns void
language sql
security invoker
set search_path = pg_catalog, public, private
as $$
  select private.admin_revoke_role(target_user, target_role);
$$;

drop policy if exists "Users can read their own roles" on public.user_roles;
create policy "Users can read their own roles"
on public.user_roles
for select
to authenticated
using (
  auth.uid() is not null
  and (
    user_id = auth.uid()
    or public.is_admin(auth.uid())
  )
);

revoke all on public.user_roles from public, anon, authenticated;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

revoke all on function private.is_admin(uuid) from public, anon, authenticated;
revoke all on function private.admin_set_role(uuid, text) from public, anon, authenticated;
revoke all on function private.admin_revoke_role(uuid, text) from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to anon, authenticated;
grant execute on function private.admin_set_role(uuid, text) to authenticated;
grant execute on function private.admin_revoke_role(uuid, text) to authenticated;

grant execute on function public.is_admin(uuid) to anon, authenticated;
grant execute on function public.current_user_roles() to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;
