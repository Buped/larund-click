-- Larund project collaboration: members, invitations, ownership transfers, notifications.
-- Built on the existing public.larund_projects system. Roles: owner | member.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.larund_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  invited_by_user_id uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table if not exists public.larund_project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  invited_user_id uuid references auth.users(id) on delete cascade,
  invited_email text not null,
  role text not null default 'member' check (role = 'member'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  message text not null default '',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz default null
);

create table if not exists public.larund_project_ownership_transfers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid references auth.users(id) on delete cascade,
  to_email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  message text not null default '',
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz default null
);

create table if not exists public.larund_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null default '',
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz default null,
  created_at timestamptz not null default now()
);

create index if not exists idx_larund_project_members_project on public.larund_project_members(project_id);
create index if not exists idx_larund_project_members_user on public.larund_project_members(user_id);
create index if not exists idx_larund_project_invitations_project on public.larund_project_invitations(project_id);
create index if not exists idx_larund_project_invitations_invited_user on public.larund_project_invitations(invited_user_id);
create index if not exists idx_larund_project_transfers_project on public.larund_project_ownership_transfers(project_id);
create index if not exists idx_larund_project_transfers_to_user on public.larund_project_ownership_transfers(to_user_id);
create index if not exists idx_larund_notifications_user on public.larund_notifications(user_id, created_at desc);

alter table public.larund_project_members enable row level security;
alter table public.larund_project_invitations enable row level security;
alter table public.larund_project_ownership_transfers enable row level security;
alter table public.larund_notifications enable row level security;

drop trigger if exists set_larund_project_members_updated_at on public.larund_project_members;

-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER -> bypass RLS, avoid policy recursion)
-- ---------------------------------------------------------------------------

create or replace function private.larund_user_is_project_member(project uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.larund_project_members
    where project_id = project and user_id = uid
  );
$$;

create or replace function private.larund_user_can_access_project(project uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.larund_projects p
    where p.id = project
      and (
        p.owner_user_id = uid
        or exists (
          select 1 from public.larund_project_members m
          where m.project_id = project and m.user_id = uid
        )
      )
  );
$$;

create or replace function private.larund_lookup_user_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select id from auth.users
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;

create or replace function private.larund_email_for_user(uid uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, auth
as $$
  select email from auth.users where id = uid limit 1;
$$;

create or replace function private.larund_notify(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  insert into public.larund_notifications (user_id, type, title, body, payload)
  values (p_user_id, p_type, p_title, p_body, coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Owner-member sync: every project owner is also an owner member row
-- ---------------------------------------------------------------------------

create or replace function private.larund_sync_owner_member()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.larund_project_members (project_id, user_id, role, invited_by_user_id)
    values (new.id, new.owner_user_id, 'owner', new.created_by_user_id)
    on conflict (project_id, user_id) do update set role = 'owner';
  end if;
  return new;
end;
$$;

drop trigger if exists larund_projects_sync_owner_member on public.larund_projects;
create trigger larund_projects_sync_owner_member
after insert on public.larund_projects
for each row
execute function private.larund_sync_owner_member();

-- Backfill owner member rows for existing projects.
insert into public.larund_project_members (project_id, user_id, role, invited_by_user_id)
select id, owner_user_id, 'owner', created_by_user_id
from public.larund_projects
on conflict (project_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: update existing larund_projects / records / preferences to allow members
-- ---------------------------------------------------------------------------

drop policy if exists "Larund users can read own projects" on public.larund_projects;
create policy "Larund members can read projects"
on public.larund_projects
for select to authenticated
using (private.larund_user_can_access_project(id, auth.uid()));

-- INSERT/UPDATE/DELETE policies remain owner-only (unchanged from prior migration).

drop policy if exists "Larund users can read project records they own" on public.larund_project_records;
create policy "Larund members can read project records"
on public.larund_project_records
for select to authenticated
using (private.larund_user_can_access_project(project_id, auth.uid()));

drop policy if exists "Larund users can write project records they own" on public.larund_project_records;
create policy "Larund members can write project records"
on public.larund_project_records
for insert to authenticated
with check (private.larund_user_can_access_project(project_id, auth.uid()));

drop policy if exists "Larund users can update project records they own" on public.larund_project_records;
create policy "Larund members can update project records"
on public.larund_project_records
for update to authenticated
using (private.larund_user_can_access_project(project_id, auth.uid()))
with check (private.larund_user_can_access_project(project_id, auth.uid()));

drop policy if exists "Larund users can delete project records they own" on public.larund_project_records;
create policy "Larund members can delete project records"
on public.larund_project_records
for delete to authenticated
using (private.larund_user_can_access_project(project_id, auth.uid()));

drop policy if exists "Larund users can create own project preference" on public.larund_user_project_preferences;
create policy "Larund users can create own project preference"
on public.larund_user_project_preferences
for insert to authenticated
with check (
  user_id = auth.uid()
  and (active_project_id is null or private.larund_user_can_access_project(active_project_id, auth.uid()))
);

drop policy if exists "Larund users can update own project preference" on public.larund_user_project_preferences;
create policy "Larund users can update own project preference"
on public.larund_user_project_preferences
for update to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and (active_project_id is null or private.larund_user_can_access_project(active_project_id, auth.uid()))
);

-- ---------------------------------------------------------------------------
-- RLS for the new tables
-- ---------------------------------------------------------------------------

-- members: any member of the same project can read; self-leave delete allowed.
drop policy if exists "members read" on public.larund_project_members;
create policy "members read"
on public.larund_project_members
for select to authenticated
using (private.larund_user_is_project_member(project_id, auth.uid()));

drop policy if exists "members leave self" on public.larund_project_members;
create policy "members leave self"
on public.larund_project_members
for delete to authenticated
using (user_id = auth.uid() and role <> 'owner');

-- invitations: inviter or invitee can read; mutations via RPC only.
drop policy if exists "invitations read" on public.larund_project_invitations;
create policy "invitations read"
on public.larund_project_invitations
for select to authenticated
using (invited_by_user_id = auth.uid() or invited_user_id = auth.uid());

-- transfers: sender or recipient can read; mutations via RPC only.
drop policy if exists "transfers read" on public.larund_project_ownership_transfers;
create policy "transfers read"
on public.larund_project_ownership_transfers
for select to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- notifications: owner of the row can read / mark read / delete. No client insert.
drop policy if exists "notifications read" on public.larund_notifications;
create policy "notifications read"
on public.larund_notifications
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "notifications update" on public.larund_notifications;
create policy "notifications update"
on public.larund_notifications
for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "notifications delete" on public.larund_notifications;
create policy "notifications delete"
on public.larund_notifications
for delete to authenticated
using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs (SECURITY DEFINER, all authorization checked against auth.uid())
-- ---------------------------------------------------------------------------

create or replace function public.list_project_members(p_project_id uuid)
returns table (user_id uuid, role text, email text, joined_at timestamptz, invited_by_user_id uuid)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not private.larund_user_can_access_project(p_project_id, auth.uid()) then
    raise exception 'not_authorized';
  end if;
  return query
    select m.user_id, m.role, private.larund_email_for_user(m.user_id), m.joined_at, m.invited_by_user_id
    from public.larund_project_members m
    where m.project_id = p_project_id
    order by case when m.role = 'owner' then 0 else 1 end, m.joined_at asc;
end;
$$;

create or replace function public.invite_project_member(p_project_id uuid, p_email text, p_message text default '')
returns public.larund_project_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_target uuid;
  v_email text := lower(trim(p_email));
  v_project public.larund_projects;
  v_inviter_email text;
  v_invitation public.larund_project_invitations;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_project from public.larund_projects where id = p_project_id;
  if v_project.id is null then raise exception 'project_not_found'; end if;
  if v_project.owner_user_id <> v_uid then raise exception 'not_owner'; end if;

  v_target := private.larund_lookup_user_by_email(v_email);
  if v_target is null then raise exception 'no_user_for_email'; end if;
  if v_target = v_uid then raise exception 'cannot_invite_self'; end if;
  if exists (select 1 from public.larund_project_members where project_id = p_project_id and user_id = v_target) then
    raise exception 'already_member';
  end if;
  if exists (select 1 from public.larund_project_invitations where project_id = p_project_id and invited_user_id = v_target and status = 'pending') then
    raise exception 'already_invited';
  end if;

  insert into public.larund_project_invitations (project_id, invited_by_user_id, invited_user_id, invited_email, role, message)
  values (p_project_id, v_uid, v_target, v_email, 'member', coalesce(p_message, ''))
  returning * into v_invitation;

  v_inviter_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_target,
    'project_invitation_received',
    'Project invitation',
    coalesce(v_inviter_email, 'Someone') || ' invited you to join ' || v_project.name || '.',
    jsonb_build_object('invitation_id', v_invitation.id, 'project_id', p_project_id, 'project_name', v_project.name, 'inviter_email', v_inviter_email)
  );

  return v_invitation;
end;
$$;

create or replace function public.accept_project_invitation(p_invitation_id uuid)
returns public.larund_project_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.larund_project_invitations;
  v_project public.larund_projects;
  v_accepter_email text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.larund_project_invitations where id = p_invitation_id for update;
  if v_inv.id is null then raise exception 'invitation_not_found'; end if;
  if v_inv.invited_user_id <> v_uid then raise exception 'not_recipient'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation_not_pending'; end if;
  if v_inv.expires_at < now() then
    update public.larund_project_invitations set status = 'expired' where id = p_invitation_id;
    raise exception 'invitation_expired';
  end if;

  update public.larund_project_invitations
    set status = 'accepted', responded_at = now()
    where id = p_invitation_id returning * into v_inv;

  insert into public.larund_project_members (project_id, user_id, role, invited_by_user_id)
  values (v_inv.project_id, v_uid, 'member', v_inv.invited_by_user_id)
  on conflict (project_id, user_id) do nothing;

  select * into v_project from public.larund_projects where id = v_inv.project_id;
  v_accepter_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_inv.invited_by_user_id,
    'project_invitation_accepted',
    'Invitation accepted',
    coalesce(v_accepter_email, 'Someone') || ' joined ' || coalesce(v_project.name, 'your project') || '.',
    jsonb_build_object('project_id', v_inv.project_id, 'project_name', v_project.name, 'member_email', v_accepter_email)
  );

  return v_inv;
end;
$$;

create or replace function public.decline_project_invitation(p_invitation_id uuid)
returns public.larund_project_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.larund_project_invitations;
  v_project public.larund_projects;
  v_email text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.larund_project_invitations where id = p_invitation_id for update;
  if v_inv.id is null then raise exception 'invitation_not_found'; end if;
  if v_inv.invited_user_id <> v_uid then raise exception 'not_recipient'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation_not_pending'; end if;

  update public.larund_project_invitations
    set status = 'declined', responded_at = now()
    where id = p_invitation_id returning * into v_inv;

  select * into v_project from public.larund_projects where id = v_inv.project_id;
  v_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_inv.invited_by_user_id,
    'project_invitation_declined',
    'Invitation declined',
    coalesce(v_email, 'Someone') || ' declined the invitation to ' || coalesce(v_project.name, 'your project') || '.',
    jsonb_build_object('project_id', v_inv.project_id, 'project_name', v_project.name, 'invitee_email', v_email)
  );

  return v_inv;
end;
$$;

create or replace function public.cancel_project_invitation(p_invitation_id uuid)
returns public.larund_project_invitations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.larund_project_invitations;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_inv from public.larund_project_invitations where id = p_invitation_id for update;
  if v_inv.id is null then raise exception 'invitation_not_found'; end if;
  if v_inv.invited_by_user_id <> v_uid then raise exception 'not_owner'; end if;
  if v_inv.status <> 'pending' then raise exception 'invitation_not_pending'; end if;

  update public.larund_project_invitations
    set status = 'cancelled', responded_at = now()
    where id = p_invitation_id returning * into v_inv;
  return v_inv;
end;
$$;

create or replace function public.leave_project(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select role into v_role from public.larund_project_members where project_id = p_project_id and user_id = v_uid;
  if v_role is null then raise exception 'not_member'; end if;
  if v_role = 'owner' then raise exception 'owner_cannot_leave'; end if;
  delete from public.larund_project_members where project_id = p_project_id and user_id = v_uid;
end;
$$;

create or replace function public.remove_project_member(p_project_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_project public.larund_projects;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_project from public.larund_projects where id = p_project_id;
  if v_project.id is null then raise exception 'project_not_found'; end if;
  if v_project.owner_user_id <> v_uid then raise exception 'not_owner'; end if;
  if p_user_id = v_project.owner_user_id then raise exception 'cannot_remove_owner'; end if;

  delete from public.larund_project_members where project_id = p_project_id and user_id = p_user_id;

  perform private.larund_notify(
    p_user_id,
    'project_member_removed',
    'Removed from project',
    'You were removed from ' || v_project.name || '.',
    jsonb_build_object('project_id', p_project_id, 'project_name', v_project.name)
  );
end;
$$;

create or replace function public.request_project_ownership_transfer(p_project_id uuid, p_email text, p_message text default '')
returns public.larund_project_ownership_transfers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(trim(p_email));
  v_target uuid;
  v_project public.larund_projects;
  v_from_email text;
  v_req public.larund_project_ownership_transfers;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_project from public.larund_projects where id = p_project_id;
  if v_project.id is null then raise exception 'project_not_found'; end if;
  if v_project.owner_user_id <> v_uid then raise exception 'not_owner'; end if;

  v_target := private.larund_lookup_user_by_email(v_email);
  if v_target is null then raise exception 'no_user_for_email'; end if;
  if v_target = v_uid then raise exception 'cannot_transfer_to_self'; end if;

  update public.larund_project_ownership_transfers
    set status = 'cancelled', responded_at = now()
    where project_id = p_project_id and status = 'pending';

  insert into public.larund_project_ownership_transfers (project_id, from_user_id, to_user_id, to_email, message)
  values (p_project_id, v_uid, v_target, v_email, coalesce(p_message, ''))
  returning * into v_req;

  v_from_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_target,
    'project_ownership_transfer_received',
    'Ownership transfer request',
    coalesce(v_from_email, 'Someone') || ' wants to transfer ownership of ' || v_project.name || ' to you.',
    jsonb_build_object('request_id', v_req.id, 'project_id', p_project_id, 'project_name', v_project.name, 'from_email', v_from_email)
  );

  return v_req;
end;
$$;

create or replace function public.accept_project_ownership_transfer(p_request_id uuid)
returns public.larund_projects
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.larund_project_ownership_transfers;
  v_project public.larund_projects;
  v_new_email text;
  v_old_owner uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_req from public.larund_project_ownership_transfers where id = p_request_id for update;
  if v_req.id is null then raise exception 'transfer_not_found'; end if;
  if v_req.to_user_id <> v_uid then raise exception 'not_recipient'; end if;
  if v_req.status <> 'pending' then raise exception 'transfer_not_pending'; end if;
  if v_req.expires_at < now() then
    update public.larund_project_ownership_transfers set status = 'expired' where id = p_request_id;
    raise exception 'transfer_expired';
  end if;

  select * into v_project from public.larund_projects where id = v_req.project_id for update;
  if v_project.id is null then raise exception 'project_not_found'; end if;
  if v_project.owner_user_id <> v_req.from_user_id then raise exception 'from_no_longer_owner'; end if;
  v_old_owner := v_project.owner_user_id;

  -- Flip ownership.
  update public.larund_projects set owner_user_id = v_uid where id = v_req.project_id returning * into v_project;

  -- New owner becomes an owner member; old owner loses access.
  insert into public.larund_project_members (project_id, user_id, role, invited_by_user_id)
  values (v_req.project_id, v_uid, 'owner', v_old_owner)
  on conflict (project_id, user_id) do update set role = 'owner';

  delete from public.larund_project_members where project_id = v_req.project_id and user_id = v_old_owner;

  update public.larund_project_ownership_transfers
    set status = 'accepted', responded_at = now() where id = p_request_id;

  -- New owner's active project preference points at this project.
  insert into public.larund_user_project_preferences (user_id, active_project_id)
  values (v_uid, v_req.project_id)
  on conflict (user_id) do update set active_project_id = excluded.active_project_id;

  v_new_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_old_owner,
    'project_ownership_transfer_accepted',
    'Ownership transferred',
    coalesce(v_new_email, 'The recipient') || ' accepted ownership of ' || v_project.name || '.',
    jsonb_build_object('project_id', v_req.project_id, 'project_name', v_project.name, 'new_owner_email', v_new_email)
  );
  perform private.larund_notify(
    v_uid,
    'project_ownership_transfer_accepted',
    'You are now the owner',
    'You are now the owner of ' || v_project.name || '.',
    jsonb_build_object('project_id', v_req.project_id, 'project_name', v_project.name)
  );

  return v_project;
end;
$$;

create or replace function public.decline_project_ownership_transfer(p_request_id uuid)
returns public.larund_project_ownership_transfers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.larund_project_ownership_transfers;
  v_project public.larund_projects;
  v_email text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_req from public.larund_project_ownership_transfers where id = p_request_id for update;
  if v_req.id is null then raise exception 'transfer_not_found'; end if;
  if v_req.to_user_id <> v_uid then raise exception 'not_recipient'; end if;
  if v_req.status <> 'pending' then raise exception 'transfer_not_pending'; end if;

  update public.larund_project_ownership_transfers
    set status = 'declined', responded_at = now() where id = p_request_id returning * into v_req;

  select * into v_project from public.larund_projects where id = v_req.project_id;
  v_email := private.larund_email_for_user(v_uid);
  perform private.larund_notify(
    v_req.from_user_id,
    'project_ownership_transfer_declined',
    'Transfer declined',
    coalesce(v_email, 'The recipient') || ' declined ownership of ' || coalesce(v_project.name, 'your project') || '.',
    jsonb_build_object('project_id', v_req.project_id, 'project_name', v_project.name, 'recipient_email', v_email)
  );

  return v_req;
end;
$$;

create or replace function public.cancel_project_ownership_transfer(p_request_id uuid)
returns public.larund_project_ownership_transfers
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.larund_project_ownership_transfers;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_req from public.larund_project_ownership_transfers where id = p_request_id for update;
  if v_req.id is null then raise exception 'transfer_not_found'; end if;
  if v_req.from_user_id <> v_uid then raise exception 'not_sender'; end if;
  if v_req.status <> 'pending' then raise exception 'transfer_not_pending'; end if;

  update public.larund_project_ownership_transfers
    set status = 'cancelled', responded_at = now() where id = p_request_id returning * into v_req;
  return v_req;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on public.larund_project_members from public, anon, authenticated;
revoke all on public.larund_project_invitations from public, anon, authenticated;
revoke all on public.larund_project_ownership_transfers from public, anon, authenticated;
revoke all on public.larund_notifications from public, anon, authenticated;

grant select, delete on public.larund_project_members to authenticated;
grant select on public.larund_project_invitations to authenticated;
grant select on public.larund_project_ownership_transfers to authenticated;
grant select, update, delete on public.larund_notifications to authenticated;

grant all on public.larund_project_members to service_role;
grant all on public.larund_project_invitations to service_role;
grant all on public.larund_project_ownership_transfers to service_role;
grant all on public.larund_notifications to service_role;

revoke all on function private.larund_user_is_project_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.larund_user_can_access_project(uuid, uuid) from public, anon, authenticated;
revoke all on function private.larund_lookup_user_by_email(text) from public, anon, authenticated;
revoke all on function private.larund_email_for_user(uuid) from public, anon, authenticated;
revoke all on function private.larund_notify(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.larund_user_is_project_member(uuid, uuid) to authenticated;
grant execute on function private.larund_user_can_access_project(uuid, uuid) to authenticated;

-- Revoke the implicit PUBLIC execute grant so anon cannot call the RPCs.
revoke all on function public.list_project_members(uuid) from public, anon;
revoke all on function public.invite_project_member(uuid, text, text) from public, anon;
revoke all on function public.accept_project_invitation(uuid) from public, anon;
revoke all on function public.decline_project_invitation(uuid) from public, anon;
revoke all on function public.cancel_project_invitation(uuid) from public, anon;
revoke all on function public.leave_project(uuid) from public, anon;
revoke all on function public.remove_project_member(uuid, uuid) from public, anon;
revoke all on function public.request_project_ownership_transfer(uuid, text, text) from public, anon;
revoke all on function public.accept_project_ownership_transfer(uuid) from public, anon;
revoke all on function public.decline_project_ownership_transfer(uuid) from public, anon;
revoke all on function public.cancel_project_ownership_transfer(uuid) from public, anon;

grant execute on function public.list_project_members(uuid) to authenticated;
grant execute on function public.invite_project_member(uuid, text, text) to authenticated;
grant execute on function public.accept_project_invitation(uuid) to authenticated;
grant execute on function public.decline_project_invitation(uuid) to authenticated;
grant execute on function public.cancel_project_invitation(uuid) to authenticated;
grant execute on function public.leave_project(uuid) to authenticated;
grant execute on function public.remove_project_member(uuid, uuid) to authenticated;
grant execute on function public.request_project_ownership_transfer(uuid, text, text) to authenticated;
grant execute on function public.accept_project_ownership_transfer(uuid) to authenticated;
grant execute on function public.decline_project_ownership_transfer(uuid) to authenticated;
grant execute on function public.cancel_project_ownership_transfer(uuid) to authenticated;
