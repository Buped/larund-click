import type { AutomationRun, AutomationTrigger } from '../../lib/automations/types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Human-readable one-line summary of a trigger. */
export function triggerSummary(trigger: AutomationTrigger): string {
  switch (trigger.kind) {
    case 'manual': return 'Runs manually';
    case 'webhook': return 'Runs on webhook';
    case 'connection_event': return `Runs on ${trigger.providerId} ${trigger.eventType}`;
    case 'folder_watch': return `Watches ${trigger.path || 'a folder'} (${trigger.pattern ?? '*'})`;
    case 'schedule': {
      if (trigger.intervalMinutes) {
        const m = trigger.intervalMinutes;
        if (m % 1440 === 0) return `Every ${m / 1440} day(s)`;
        if (m % 60 === 0) return `Every ${m / 60} hour(s)`;
        return `Every ${m} minute(s)`;
      }
      return trigger.cron ? cronToText(trigger.cron) : 'Scheduled';
    }
  }
}

export function runTriggerSummary(run: AutomationRun): string | null {
  const payload = run.triggerPayload;
  if (!payload || payload.kind !== 'folder_watch') return null;
  const fileName = typeof payload.fileName === 'string'
    ? payload.fileName
    : typeof payload.filePath === 'string'
      ? payload.filePath.split(/[\\/]/).pop() ?? payload.filePath
      : 'matching file';
  return `Triggered by folder: ${fileName}`;
}

/** Best-effort human text for the simple cron strings the wizard generates. */
export function cronToText(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return `Cron: ${cron}`;
  const [min, hr, dom, , dow] = parts;
  const time = /^\d+$/.test(min) && /^\d+$/.test(hr) ? `${hr.padStart(2, '0')}:${min.padStart(2, '0')}` : cron;
  if (dow !== '*' && /^\d$/.test(dow)) return `Weekly on ${WEEKDAYS[+dow]} at ${time}`;
  if (dom !== '*' && /^\d+$/.test(dom)) return `Monthly on day ${dom} at ${time}`;
  if (dom === '*' && dow === '*') return `Daily at ${time}`;
  return `Cron: ${cron}`;
}
