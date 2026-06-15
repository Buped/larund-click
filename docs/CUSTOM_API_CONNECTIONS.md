# Custom API Connections

Custom API MVP supports simple REST tools:

- connection: base URL, auth type placeholder, secret reference
- tool: method, path template, schemas, risk, enabled state

Risk classification:

- GET: `external_read`
- POST/PUT/PATCH: `external_write`
- DELETE: `destructive`
- send/publish/message names or paths: `external_send`

Calls pass through policy approval and audit. The MVP adapter records the call and renders the target URL; production should add real HTTP execution with allowlists, timeouts, response limits, and secret-store integration.
