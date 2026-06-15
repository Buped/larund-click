# Telegram Or Webhook Setup

Phase 3 ships the gateway foundation and a fully working local/mock channel. Telegram is not enabled yet.

Recommended Phase 4 Telegram shape:

1. Store a bot token in the Connections/Secrets layer.
2. Link explicit chat IDs to a Larund user and optional workspace.
3. Reject unknown chat IDs.
4. Route text through `routeGatewayMessage`.
5. Send task completion/failure summaries only to the linked chat.
6. Resolve approvals through `/approve <id>` and `/deny <id>`.

Webhook MVP shape:

1. Create a `webhook` gateway channel with a secret token.
2. Accept JSON payloads only when the token matches.
3. Map payload to `/task <prompt>` or a configured workflow.
4. Send callbacks only to preconfigured callback URLs and only when policy allows it.

Security limitations:

- do not log bot tokens or webhook secrets
- do not accept arbitrary senders
- external send/publish/delete still require approval
- callback delivery should be treated as an external send
