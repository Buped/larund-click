# Projects

Larund Click stores Project identity and transferable workflow data in Supabase.
The sidebar Project selector reads `public.larund_projects` and persists the
selected project in `public.larund_user_project_preferences`.

## Migration

Apply the Supabase migration:

```sql
supabase/migrations/20260619152000_larund_projects_and_project_records.sql
```

The migration creates:

- `public.larund_projects`
- `public.larund_user_project_preferences`
- `public.larund_project_records`
- owner-only RLS policies for projects
- preference RLS policies that only allow selecting a project owned by the user
- project-record RLS policies that follow the current project owner

## Manual SQL Checks

Create a project for the current authenticated user through the app, or with a
service role SQL session:

```sql
insert into public.larund_projects (owner_user_id, created_by_user_id, name, kind)
select id, id, 'Client Alpha', 'project'
from auth.users
where email = 'USER_EMAIL_HERE';
```

Set the active project:

```sql
insert into public.larund_user_project_preferences (user_id, active_project_id)
select u.id, p.id
from auth.users u
join public.larund_projects p on p.owner_user_id = u.id
where u.email = 'USER_EMAIL_HERE'
and p.name = 'Client Alpha'
on conflict (user_id) do update
set active_project_id = excluded.active_project_id;
```

Archive a project:

```sql
update public.larund_projects
set status = 'archived', archived_at = now()
where owner_user_id = (select id from auth.users where email = 'USER_EMAIL_HERE')
and name = 'Client Alpha';
```

## Transfer Model

Project ownership lives on `public.larund_projects.owner_user_id`. Anything stored
in `public.larund_project_records` belongs to the Project, so changing the Project
owner changes who can read and manage those records.

Transferable project/workflow data:

- automations and automation runs
- task queue items, task runs, and task evidence
- custom workflow templates
- builder skills tied to a Project
- MCP server configs and discovered tool approvals tied to a Project
- custom API/tool definitions tied to a Project

Personal or machine-local data:

- memory and memory suggestions
- connected account tokens / personal credentials
- notifications
- chat message bodies and local UI state
- legacy local records without a Project id

## Test Steps

1. Sign in as a new user.
2. Confirm a default `Personal` Project appears in the left sidebar.
3. Create `teszt 1` from the sidebar.
4. Create `teszt 2` from the sidebar.
5. Open the left Project selector and confirm both Projects are listed.
6. Switch back to `teszt 1`.
7. Close and reopen the app.
8. Confirm `teszt 1` is still the active Project.
9. Switch to `teszt 2`.
10. Confirm Chat, Skills, Memory, Connections, MCP, and Automations receive the new Project id.
11. Create a chat in `teszt 2`, switch to `teszt 1`, and confirm the chat list reloads for the active Project.
12. Sign out and sign in as user B.
13. Confirm user B cannot see user A's Projects.
14. Confirm user B gets their own default `Personal` Project.
15. Try to upsert `larund_user_project_preferences.active_project_id` to another user's Project with the anon/authenticated client; RLS should reject it.

## Security Notes

- The active Project is not trusted from browser storage.
- Users can only read, create, update, archive, and select their own Projects.
- `service_role` can still manage all rows for administrative support tasks.
