// Automations — the single home for scheduled, recurring, manual, and
// folder-triggered work. The old separate "Scheduler" screen is gone; its job
// (time-based runs) now lives here on top of the persistent automations store.
// Every automation run produces a TaskRun + evidence, visible on the Tasks page.

import { AutomationsTab } from '../phase3';
import { PageFrame, PageHeader } from './ui';

export function AutomationsPage({ userId }: { userId: string }) {
  return (
    <PageFrame>
      <PageHeader title="Automations" subtitle="Let Larund run tasks on a schedule, on repeat, on demand, or when a folder changes. Each run is verified and recorded in Tasks." />
      <AutomationsTab userId={userId} />
    </PageFrame>
  );
}
