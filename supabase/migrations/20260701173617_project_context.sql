-- Larund Project Context: shared project brief, instructions, source inventory,
-- chunked text retrieval, and audit events. Built on larund_projects membership.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.larund_project_context (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  brief text not null default '',
  instructions text not null default '',
  ai_summary text not null default '',
  source_summary text not null default '',
  context_version integer not null default 1,
  last_compiled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create table if not exists public.larund_project_sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  title text not null,
  source_type text not null check (source_type in ('upload_text', 'pasted_text')),
  file_name text,
  mime_type text,
  extension text,
  content_text text not null,
  content_sha256 text not null,
  char_count integer not null,
  byte_size integer not null,
  token_estimate integer not null,
  summary text not null default '',
  status text not null default 'processing' check (status in ('processing', 'ready', 'failed', 'disabled')),
  error_message text,
  is_enabled boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  last_indexed_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.larund_project_source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.larund_project_sources(id) on delete cascade,
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  chunk_index integer not null,
  heading text,
  content text not null,
  char_count integer not null,
  token_estimate integer not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.larund_project_context_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.larund_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  event_type text not null,
  details_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_larund_project_sources_project on public.larund_project_sources(project_id);
create index if not exists idx_larund_project_sources_project_status on public.larund_project_sources(project_id, status);
create index if not exists idx_larund_project_sources_project_enabled on public.larund_project_sources(project_id, is_enabled);
create unique index if not exists idx_larund_project_sources_project_hash on public.larund_project_sources(project_id, content_sha256);
create index if not exists idx_larund_project_source_chunks_project on public.larund_project_source_chunks(project_id);
create index if not exists idx_larund_project_source_chunks_source on public.larund_project_source_chunks(source_id);
create unique index if not exists idx_larund_project_source_chunks_source_index on public.larund_project_source_chunks(source_id, chunk_index);
create index if not exists idx_larund_project_context_events_project on public.larund_project_context_events(project_id, created_at desc);

drop trigger if exists set_larund_project_context_updated_at on public.larund_project_context;
create trigger set_larund_project_context_updated_at
before update on public.larund_project_context
for each row
execute function private.larund_set_updated_at();

drop trigger if exists set_larund_project_sources_updated_at on public.larund_project_sources;
create trigger set_larund_project_sources_updated_at
before update on public.larund_project_sources
for each row
execute function private.larund_set_updated_at();

alter table public.larund_project_context enable row level security;
alter table public.larund_project_sources enable row level security;
alter table public.larund_project_source_chunks enable row level security;
alter table public.larund_project_context_events enable row level security;

-- Context: owners and members can read/write in this MVP.
drop policy if exists "project context read" on public.larund_project_context;
create policy "project context read"
on public.larund_project_context
for select to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project context insert" on public.larund_project_context;
create policy "project context insert"
on public.larund_project_context
for insert to authenticated
with check (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project context update" on public.larund_project_context;
create policy "project context update"
on public.larund_project_context
for update to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())))
with check (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project context delete" on public.larund_project_context;
create policy "project context delete"
on public.larund_project_context
for delete to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

-- Sources and chunks follow the same shared-project access model.
drop policy if exists "project sources read" on public.larund_project_sources;
create policy "project sources read"
on public.larund_project_sources
for select to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project sources insert" on public.larund_project_sources;
create policy "project sources insert"
on public.larund_project_sources
for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and private.larund_user_can_access_project(project_id, (select auth.uid()))
);

drop policy if exists "project sources update" on public.larund_project_sources;
create policy "project sources update"
on public.larund_project_sources
for update to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())))
with check (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project sources delete" on public.larund_project_sources;
create policy "project sources delete"
on public.larund_project_sources
for delete to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project chunks read" on public.larund_project_source_chunks;
create policy "project chunks read"
on public.larund_project_source_chunks
for select to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project chunks insert" on public.larund_project_source_chunks;
create policy "project chunks insert"
on public.larund_project_source_chunks
for insert to authenticated
with check (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project chunks update" on public.larund_project_source_chunks;
create policy "project chunks update"
on public.larund_project_source_chunks
for update to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())))
with check (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project chunks delete" on public.larund_project_source_chunks;
create policy "project chunks delete"
on public.larund_project_source_chunks
for delete to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project context events read" on public.larund_project_context_events;
create policy "project context events read"
on public.larund_project_context_events
for select to authenticated
using (private.larund_user_can_access_project(project_id, (select auth.uid())));

drop policy if exists "project context events insert" on public.larund_project_context_events;
create policy "project context events insert"
on public.larund_project_context_events
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.larund_user_can_access_project(project_id, (select auth.uid()))
);

revoke all on public.larund_project_context from public, anon, authenticated;
revoke all on public.larund_project_sources from public, anon, authenticated;
revoke all on public.larund_project_source_chunks from public, anon, authenticated;
revoke all on public.larund_project_context_events from public, anon, authenticated;

grant select, insert, update, delete on public.larund_project_context to authenticated;
grant select, insert, update, delete on public.larund_project_sources to authenticated;
grant select, insert, update, delete on public.larund_project_source_chunks to authenticated;
grant select, insert on public.larund_project_context_events to authenticated;

grant all on public.larund_project_context to service_role;
grant all on public.larund_project_sources to service_role;
grant all on public.larund_project_source_chunks to service_role;
grant all on public.larund_project_context_events to service_role;
