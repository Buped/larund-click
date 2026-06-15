# Phase 3 Automations

Larund Click now has a persistent automation engine for delegated work.

Automations live in the shared `coworker_kv` document store and contain:

- trigger: manual, schedule, webhook placeholder, connection event, or folder watch
- task template: prompt plus optional skills, workflow, role, and connections
- autonomy mode and approval policy
- visible run history

On app startup, `restoreAutomationScheduler(userId)` restores enabled scheduled automations. Missed runs are explicit: Larund does not backfill every missed run. If a run was missed by less than the configured threshold, it runs once. If it was missed beyond the threshold, Larund records a skipped `AutomationRun`.

The first MVP runner enqueues automation work into the persistent task queue and creates a TaskRun/evidence trail through the queue processor. Full long-running agent execution can be connected by replacing the queue processor with one that invokes the agent loop.

Security:

- no mouse/cursor/pixel automation
- destructive and external send policies default to approval-required
- pause/resume/delete are available from the Automations tab
- every automation run creates durable run state, and queue execution creates TaskRun evidence

Known limitation: simple cron uses UTC math in this MVP. The automation stores timezone for future timezone-aware scheduling.
