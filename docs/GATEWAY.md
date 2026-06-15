# Gateway Foundation

The gateway layer lets external channels delegate tasks without bypassing Larund's workspace, queue, approval, and audit systems.

Implemented:

- gateway channel and message stores
- command parser
- local/mock gateway channel
- trusted sender enforcement
- queue-backed `/task`
- `/status`
- `/approve`
- `/deny`
- `/workspaces`
- `/use_workspace`
- `/help`

Mock gateway usage:

1. Open Coworker Core -> Gateway.
2. Create a local channel.
3. Send `/task create a test file and verify it` from `local-user`.
4. Confirm a queue item and TaskRun are created.

Sender trust:

- channels may define `trustedSenderIds`
- unknown senders are rejected and recorded as rejected inbound messages
- no arbitrary sender can create tasks unless explicitly linked

Gateway-created tasks still enter the same task queue and approval model as in-app tasks.
