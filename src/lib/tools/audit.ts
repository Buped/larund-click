import type { AuditEntry, AuditLogger } from './types';

// Patterns whose values must never reach the audit log.
const SECRET_KEYS = /(token|secret|password|api[_-]?key|authorization|cookie|bearer|client[_-]?secret)/i;

/** Redact secret-looking values from an args object before logging. */
export function sanitizeArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args, (key, value) => {
      if (SECRET_KEYS.test(key)) return '«redacted»';
      if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…';
      return value;
    });
    // Also blank out anything that looks like a long token literal.
    return (json ?? '').replace(/[A-Za-z0-9_-]{32,}/g, '«redacted»');
  } catch {
    return '[unserializable]';
  }
}

export function summarizeOutput(output: string | undefined, max = 400): string | undefined {
  if (!output) return output;
  const clipped = output.length > max ? output.slice(0, max) + '…' : output;
  return clipped.replace(/[A-Za-z0-9_-]{32,}/g, '«redacted»');
}

/** Simple in-memory audit logger. Callers can subscribe via onEntry. */
export class MemoryAuditLogger implements AuditLogger {
  private entries: AuditEntry[] = [];
  constructor(private onEntry?: (entry: AuditEntry) => void) {}

  record(entry: AuditEntry): void {
    this.entries.push(entry);
    this.onEntry?.(entry);
  }

  list(): AuditEntry[] {
    return [...this.entries];
  }
}

let counter = 0;
export function newAuditId(): string {
  counter += 1;
  return `audit-${Date.now()}-${counter}`;
}
