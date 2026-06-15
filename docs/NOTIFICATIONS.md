# Notifications

Notifications are persistent records for task status, approvals, automation failures, connection errors, memory suggestions, and system events.

The current emitters cover:

- task completed
- task failed
- approval needed
- automation failed

Notifications can be listed and marked read in Coworker Core -> Notifications.

Notifications intentionally store concise summaries and references such as `task:<id>` or `approval:<id>`, not secret payloads.
