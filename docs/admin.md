# Admin roles

Larund Click uses a real, Supabase-backed admin system. Admin status decides who
can see developer/operator surfaces and (later) the admin workflow builder. It is
**never** a localStorage-only flag — the source of truth is the database.

## Data model

`public.user_roles` (migration `20260619140000_admin_user_roles.sql`):

| column     | type          | notes                                                        |
|------------|---------------|--------------------------------------------------------------|
| id         | uuid          | pk, `gen_random_uuid()`                                       |
| user_id    | uuid          | `references auth.users(id) on delete cascade`                 |
| role       | text          | check in `admin`, `user`, `workflow_builder`, `support`, `owner` |
| created_at | timestamptz   | `now()`                                                       |
| updated_at | timestamptz   | `now()`, kept fresh by a trigger                             |
|            |               | `unique(user_id, role)`                                       |

### Security model (RLS)

RLS is enabled. Clients are **read-only**:

- `select` policy: a user can read their own roles; an admin can read all roles
  (`user_id = auth.uid() or public.is_admin(auth.uid())`).
- There are **no** insert/update/delete policies for `authenticated`/`anon`, so a
  user cannot grant themselves a role with the anon key.
- Role changes happen only via the **service role** (bypasses RLS) or the
  `SECURITY DEFINER` admin RPCs below, which require the caller to already be an admin.

### Functions

- `public.is_admin(uid uuid default auth.uid()) returns boolean`
  Public RPC wrapper around a private `SECURITY DEFINER` helper. Returns true
  when the user holds the `admin` role.
- `public.current_user_roles() returns text[]` — the caller's roles.
- `public.admin_set_role(target_user uuid, target_role text)` — admin-only; grants a role.
- `public.admin_revoke_role(target_user uuid, target_role text)` — admin-only; revokes a role.

## Frontend

- `src/lib/admin.ts` — `isCurrentUserAdmin()`, `getCurrentUserRole()`,
  `getCurrentUserRoles()`, `getAdminState(userId?, email?)`. Admin-only UI gates
  use `AuthUser.isAdmin`, loaded from Supabase during login/restore; localStorage
  is never an authority for admin access.
- `src/lib/auth.ts` — `AuthUser` now has `isAdmin: boolean`, loaded after `signIn`
  and `restoreSession`, cleared on `signOut`.
- `App.tsx` passes `isAdmin` to `NavRail`; `SettingsScreen` reads `user.isAdmin`.
- Gated surfaces (hidden entirely for non-admins):
  - **Automations** workflow-builder route.
  - Settings → **Developer** and **Operator** sections + the **Developer mode** toggle.
  - `ConnectionsPage` developer setup (raw app credentials) via `isDeveloperUiEnabled(user.isAdmin)`.
  - `NavRail` shows an admin-only shield entry.

## Setting an admin

Run in the Supabase SQL editor (or any service-role connection):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin'
from auth.users
where email = 'ADMIN_EMAIL_HERE'
on conflict (user_id, role) do nothing;
```

Remove admin:

```sql
delete from public.user_roles
where user_id = (select id from auth.users where email = 'ADMIN_EMAIL_HERE')
  and role = 'admin';
```

An existing admin can also grant/revoke from an authenticated client:

```ts
await supabase.rpc('admin_set_role',   { target_user: '<uuid>', target_role: 'admin' });
await supabase.rpc('admin_revoke_role',{ target_user: '<uuid>', target_role: 'admin' });
```

## Dev-only shortcut

For local development you may set `VITE_ADMIN_EMAILS=you@example.com,other@example.com`
in `.env`. It is honored **only** when `import.meta.env.DEV` is true (never in a
production build) and never writes to the database. Do not rely on it for production.

## Testing

1. **Admin user** — make your account admin with the SQL above, sign in:
   - Settings shows the **Developer mode** toggle; enabling it reveals the
     **Developer** and **Operator** sections.
   - The **Automations** workflow-builder route is visible.
   - The NavRail shows the admin shield.
2. **Normal user** — sign in with a non-admin account:
   - No Automations route, no Developer mode toggle, no Developer/Operator sections, no admin shield.
   - Setting `localStorage.developer_mode = 'true'` by hand reveals **nothing**
     because the gate also requires Supabase-loaded `AuthUser.isAdmin`.
3. **Privilege escalation is blocked** — as a normal user, from the app/anon key:

   ```ts
   // All of these fail (RLS / authorization), proving no self-promotion:
   await supabase.from('user_roles').insert({ user_id: myId, role: 'admin' }); // RLS denies
   await supabase.rpc('admin_set_role', { target_user: myId, target_role: 'admin' }); // raises "not authorized"
   ```
4. **Verify the RPC** — `select public.is_admin();` returns true only for admins.
