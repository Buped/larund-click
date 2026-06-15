# Task Queue

The queue stores background work from chat, automations, gateway messages, and manual enqueue actions.

`TaskQueueItem` states are `queued`, `running`, `waiting_approval`, `completed`, `failed`, and `cancelled`.

Concurrency rules:

- one running task per workspace by default
- configurable global maximum, default 4
- priority order is high, normal, low

The default processor creates a durable `TaskRun`, records queue evidence, completes the run, and emits a completion/failure notification. This makes background work auditable even before a richer long-running worker is attached.

Users can inspect queued/running/waiting tasks in Coworker Core -> Queue, cancel queued or approval-waiting tasks, and retry failed tasks.
