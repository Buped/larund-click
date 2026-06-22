# Google Workspace Connection — Production Audit (Wave 0, Task 1)

**Date:** 2026-06-22
**Scope:** Gmail, Calendar, Sheets, Docs, Drive — what actually calls the Google API
vs. what is a stub/mock, scope coverage, token/refresh wiring, read-back, error
mapping, approval gating, Test Connection, and documentation drift.

> ## ✅ Wave 0 implementation status (2026-06-22, post-audit)
> All gaps below are now **closed in code** (459 unit tests pass, `tsc` clean):
> - **Gmail** built from scratch: `search`, `read`, `create_draft`, `send` (send is
>   `external_send` → approval-gated, read-back confirms SENT).
> - **Calendar** built: `list_events`, `find_free_slots` (freeBusy + gap calc),
>   `create_event` (`external_send`, read-back confirms the event).
> - **Scopes unified** in `auth.ts` and reused by `oauth/flow.ts` + `providerAuth.ts`
>   (+Gmail/Calendar/full-Drive). **Restricted-scope caveat documented.**
> - **Shared client** (`client.ts`): one fetch path, typed `GoogleApiError`,
>   Hungarian `mapGoogleError` (401/403-api-disabled/403-scope/404/429/5xx),
>   base64url MIME helpers.
> - **Automatic read-back** added to every Sheets/Docs/Drive write.
> - **Per-sub-service Test Connection** (Account/Gmail/Calendar/Drive/Sheets/Docs)
>   with 🟢/🔴 breakdown; surfaced through the Connections card.
> - **Docs drift fixed** (CONNECTIONS.md + manifest description).
>
> **Remaining = live validation only:** the smoke test must be run with a real Google
> Cloud OAuth app (Gmail/Calendar/Sheets/Docs/Drive APIs enabled) + a test Workspace
> account. No mock/stub. See §8.

**Bottom line:** The connection is **partially real, not "working" end-to-end**. The
OAuth + token-refresh plumbing is solid and shared. **Sheets, Docs and Drive make
real API calls; Gmail and Calendar are pure non-functional scaffolds.** Three
systemic gaps block all five sub-services from meeting the Wave 0 acceptance
criteria: (1) OAuth **scopes are too narrow** (no Gmail/Calendar scopes; Drive is
`drive.file`-only), (2) **no automatic read-back** after writes, and (3) **no
human-readable error mapping** (raw `google_api_403: …` is thrown). The
documentation is internally contradictory (Wave 0's stated symptom).

---

## 1. Per-method status: real API vs stub/mock

Legend: **REAL** = issues a live Google API call · **MOCK-ONLY** = only works with
`mock:true` · **STUB** = always returns a `*_not_enabled` failure.

### Gmail — [src/lib/connections/providers/google-workspace/gmail.ts](src/lib/connections/providers/google-workspace/gmail.ts)
| Tool | Status | Notes |
|---|---|---|
| `google.gmail.search` | **STUB** | Returns `{ success:false, error:'gmail_scaffold_not_enabled' }`. No API call, no mock. |
| search_messages / read_message / create_draft / send_draft / send_message | **MISSING** | None of the Wave 0 Gmail tools exist. |

**Gmail is 0% implemented.** This is the single most important sub-service for the
target customer (every follow-up/quote/report send) and it does nothing.

### Calendar — [src/lib/connections/providers/google-workspace/calendar.ts](src/lib/connections/providers/google-workspace/calendar.ts)
| Tool | Status | Notes |
|---|---|---|
| `google.calendar.create_event` | **STUB** | Returns `calendar_scaffold_not_enabled`. No API call, no mock. |
| list_events / find_free_slots / get | **MISSING** | Not implemented. |

**Calendar is 0% implemented.**

### Sheets — [src/lib/connections/providers/google-workspace/sheets.ts](src/lib/connections/providers/google-workspace/sheets.ts)
| Tool | Status | Notes |
|---|---|---|
| `google.sheets.create` | **REAL** | `POST /v4/spreadsheets`. |
| `google.sheets.write_values` | **REAL** | `PUT …/values/{range}?valueInputOption=USER_ENTERED`. **No read-back.** |
| `google.sheets.append_values` | **REAL** | `…:append`. **No read-back.** |
| `google.sheets.read_values` | **REAL** | `GET …/values/{range}`. |
| `google.sheets.get_metadata` | **REAL** | `GET …/{id}?includeGridData=false`. |
| `google.sheets.export_xlsx` | **REAL** | Via Drive export → optional local file write. |

**Sheets is functionally complete** but violates acceptance criterion "automatic
read-back after every write" — the read-back exists only as a *prose instruction*
in the bundled skill ([src/lib/skills/bundled.ts:108](src/lib/skills/bundled.ts#L108)
"Always call read_values after writing"), not enforced in code.

### Docs — [src/lib/connections/providers/google-workspace/docs.ts](src/lib/connections/providers/google-workspace/docs.ts)
| Tool | Status | Notes |
|---|---|---|
| `google.docs.create` | **REAL** | `POST https://docs.googleapis.com/v1/documents`. |
| `google.docs.insert_text` | **REAL** | `:batchUpdate` with `insertText` at index 1. **No read-back.** |
| `google.docs.batch_update` | **REAL** | Passes raw `requests[]`. **No read-back.** |
| `google.docs.read` | **REAL** | `GET /v1/documents/{id}` + text extraction. |
| `google.docs.get_metadata` | **REAL** | title/revisionId. |
| `google.docs.export_docx` / `export_pdf` | **REAL** | Via Drive export. |

**Docs is functionally complete**, same read-back gap.

### Drive — [src/lib/connections/providers/google-workspace/drive.ts](src/lib/connections/providers/google-workspace/drive.ts)
| Tool | Status | Notes |
|---|---|---|
| `google.drive.search` | **REAL (scope-limited)** | `GET /drive/v3/files?q=…`. With `drive.file` scope this **only sees files the app created** — it cannot find the user's existing files. See §2. |
| `google.drive.get_file` | **REAL** | metadata. |
| `google.drive.create_folder` | **REAL** | folder mimeType. **No read-back.** |
| `google.drive.upload` | **REAL** | multipart upload, reads bytes via Tauri `file_read_bytes`. **No read-back.** |
| `google.drive.download_export` | **REAL** | export to local path. |
| `google.drive.move_file` | **REAL** | recompute parents + PATCH. |

### Test connection — [src/lib/connections/providers/google-workspace/tools.ts:11](src/lib/connections/providers/google-workspace/tools.ts#L11)
| Tool | Status | Notes |
|---|---|---|
| `google.test_connection` | **REAL but shallow** | Hits `/oauth2/v3/userinfo` only. Verifies the **token**, not that Sheets/Docs/Drive/Gmail/Calendar APIs are enabled or scoped. Acceptance criterion wants a **per-sub-service** read-only probe. |

---

## 2. Scope coverage — the biggest correctness bug

There are **two different scope lists that disagree**, and **neither covers Gmail or
Calendar**:

- **Manifest/auth** ([auth.ts:6](src/lib/connections/providers/google-workspace/auth.ts#L6),
  `GOOGLE_WORKSPACE_SCOPES`): `drive.file`, `spreadsheets`, `documents` — **3 scopes**.
- **OAuth connect** ([oauth/flow.ts:40](src/lib/connections/oauth/flow.ts#L40),
  `defaultScopes`): adds `calendar` → **4 scopes**.

Consequences:
1. **Gmail can never work** even once tools are written: no `gmail.*` scope is ever
   requested at consent. Need (delegated): `gmail.readonly` (or `gmail.metadata`),
   `gmail.compose`, `gmail.send`, `gmail.modify`.
2. **Calendar tools, when written, would have a scope** (flow.ts requests `calendar`)
   but the manifest's advertised scope list omits it — the two lists must be unified.
3. **Drive search is crippled.** `drive.file` grants access only to files the app
   created/opened. "Find a file in the Drive" (Wave 0 smoke test #5) will silently
   return an empty set. Decide between `drive.readonly`/`drive` (broader, needs Google
   verification/consent screen work) vs. keeping `drive.file` and documenting the
   limitation.
4. The userinfo call in `test_connection` needs `openid email`/`userinfo.email` to
   reliably return the address.

**Action:** collapse to a single source-of-truth scope list, expand it, and have the
manifest advertise exactly what is requested.

---

## 3. Token & refresh wiring — this part is healthy

- Tools read `secrets.GOOGLE_WORKSPACE_ACCESS_TOKEN` via `googleAuthFromSecrets`
  ([auth.ts:12](src/lib/connections/providers/google-workspace/auth.ts#L12)).
- That secret is injected at call time by
  [runtimeCredentials.ts](src/lib/connections/runtimeCredentials.ts) from the
  per-user **ConnectedAccount store** (resolution order: connected account → dev
  shortcut → MCP → blocker), and it **refreshes near-expiry OAuth tokens**
  before use ([runtimeCredentials.ts:123](src/lib/connections/runtimeCredentials.ts#L123)
  → `refreshProviderTokenIfNeeded` → `refreshOAuthTokens`).
- App secret vs. user token separation is correctly enforced (env schema marks the
  old `GOOGLE_WORKSPACE_*` keys as **legacy**; production path is OAuth client +
  ConnectedAccount store).

**No change needed here** other than one robustness gap: a refresh failure is
swallowed (`catch {}`) and surfaces later as a raw 401 — which ties into §4.

---

## 4. Error handling — not acceptance-ready

- Tool helpers throw raw strings: `google_api_403: …`, `google_drive_api_404: …`,
  `google_docs_api_429: …` ([sheets.ts:26](src/lib/connections/providers/google-workspace/sheets.ts#L26),
  [drive.ts:11](src/lib/connections/providers/google-workspace/drive.ts#L11),
  [docs.ts:26](src/lib/connections/providers/google-workspace/docs.ts#L26)).
- The registry wraps any throw as `connection_error: Error: google_api_403: …`
  ([registry.ts:132](src/lib/connections/registry.ts#L132)) — a stack-ish string, not
  the human-readable, actionable Hungarian message Wave 0 requires.
- **Missing:** a shared `mapGoogleError(status, body)` that distinguishes 401
  (token expired → reconnect), 403 (API not enabled in the Cloud project / insufficient
  scope — and these two 403 sub-cases read very differently in the body), 404, 429/
  quota (back off + retry), and returns `{ message, suggestedAction }`.

---

## 5. Approval gating — partial

- Risk is declared per-tool in the manifest and drives approval
  ([registry.ts:33](src/lib/connections/registry.ts#L33)). Current Google tools use
  only `external_read` / `external_write`. There is **no `external_send`-class tool**
  yet because Gmail send / Calendar invite don't exist.
- Wave 0 requires `send_message` and `create_event(attendees)` to **always** route
  through `approval.request` unless the user disabled it. When those tools are added
  they must carry the send-class risk and be verified against the approval flow in
  [src/lib/tools/run.ts](src/lib/tools/run.ts) (needs confirmation that the risk
  taxonomy has a distinct send tier — to verify during implementation).

---

## 6. Documentation drift (the stated Wave 0 symptom — confirmed)

Concrete contradictions found:
- [docs/CONNECTIONS.md:37](docs/CONNECTIONS.md#L37): Google Workspace = **"scaffold …
  disabled until OAuth."**
- [docs/CONNECTIONS.md:50](docs/CONNECTIONS.md#L50): "Reads fall back to deterministic
  **mock output when unauthenticated**." — **False in production.**
  [mock-guard.ts:20](src/lib/connections/mock-guard.ts#L20) keeps mocks **off by
  default**; missing auth returns a structured `missing_auth` error.
- [env/schema.ts:134](src/lib/connections/env/schema.ts#L134): google-workspace is
  `active: true`, full OAuth, refresh-capable — i.e. **not** a scaffold.
- Manifest description ([manifest.ts:8](src/lib/connections/providers/google-workspace/manifest.ts#L8))
  says "Drive, Sheets and Docs" and "mock mode available for tests" — **omits Gmail &
  Calendar**, and oversells mock mode.

These three sources each describe a different state — exactly the "once working, once
disabled" confusion Wave 0 set out to kill.

---

## 7. Gap list mapped to Wave 0 tasks

| Wave 0 task | State | Work required |
|---|---|---|
| 1. Audit | ✅ this doc | — |
| 2. Gmail toolkit | ❌ stub | Build search/read/draft/send from scratch; **add Gmail scopes**; send → approval; read-back into Sent. |
| 3. Calendar toolkit | ❌ stub | Build list/find_free_slots/create; unify `calendar` scope; attendees → approval; read-back. |
| 4. Sheets toolkit | 🟡 real, no read-back | Add **automatic read-back** to write/append; keep API as-is. |
| 5. Docs toolkit | 🟡 real, no read-back | Optional read-back after batch_update; otherwise complete. |
| 6. Drive toolkit | 🟡 real, scope-limited | Decide Drive scope (`drive.file` vs broader); read-back on folder/upload. |
| 7. Error mapping | ❌ missing | Shared `mapGoogleError` + surface through registry; humanize. |
| 8. Test Connection (per-sub-service) | 🟡 shallow | Expand `test_connection` to probe all 5 with read-only calls + per-service green/red; wire button on the Google card. |

**Cross-cutting:** unify the two scope lists (§2); fix docs (§6); add a shared
`readBack()` helper so every write tool reports verified state into the evidence/task
log (criterion: "every write-tool has automatic read-back, logged to evidence").

---

## 8. Recommended implementation order (within Wave 0)

1. **Scopes + error mapping + read-back helper** (foundation; unblocks everything).
2. **Gmail** (highest customer value, currently zero).
3. **Calendar** (second zero).
4. **Sheets/Docs/Drive read-back** (small deltas on working code).
5. **Per-sub-service Test Connection + card button.**
6. **Docs rewrite** to match reality, then run the Google Workspace smoke test with a
   **live** test account (criterion: no mock/stub).

> Note: steps 2–5 require a real Google Cloud OAuth app with the expanded APIs enabled
> (Gmail, Calendar, Sheets, Docs, Drive) and a test Workspace account before the
> acceptance smoke test can be run live.
</content>
</invoke>
