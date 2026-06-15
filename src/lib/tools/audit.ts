import type { AuditEntry, AuditLogger } from './types';

// Patterns whose values must never reach the audit log, evidence, UI previews,
// or prompt-visible summaries.
const SECRET_KEYS = /(token|secret|password|api[_-]?key|authorization|cookie|bearer|client[_-]?secret|private[_-]?key)/i;
const SECRET_VALUE =
  /\b(?:Bearer\s+)?[A-Za-z0-9._~+/=-]{32,}\b|AIza[0-9A-Za-z_-]{20,}|ya29\.[0-9A-Za-z._-]+|sk-[A-Za-z0-9_-]{20,}/g;

/** Redact secret-looking values from an args object before logging. */
export function sanitizeArgs(args: unknown): string {
  try {
    const json = JSON.stringify(args, (key, value) => {
      if (SECRET_KEYS.test(key)) return 'redacted';
      if (typeof value === 'string') {
        return redactSecrets(value.length > 300 ? `${value.slice(0, 300)}...` : value);
      }
      return value;
    });
    return redactSecrets(json ?? '');
  } catch {
    return '[unserializable]';
  }
}

export function summarizeOutput(output: string | undefined, max = 400): string | undefined {
  if (!output) return output;
  const clipped = output.length > max ? `${output.slice(0, max)}...` : output;
  return redactSecrets(clipped);
}

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET_VALUE, 'redacted')
    .replace(/(authorization|api[_-]?key|token|password|secret|cookie)\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=redacted');
}

/** Simple in-memory audit logger. Callers can subscribe via onEntry. */
export class MemoryAuditLogger implements AuditLogger {
  private entries: AuditEntry[] = [];
  constructor(private onEntry?: (entry: AuditEntry) => void) {}

  record(entry: AuditEntry): void {
    const sanitized: AuditEntry = {
      ...entry,
      argsSummary: sanitizeArgs(entry.argsSummary),
      outputSummary: summarizeOutput(entry.outputSummary),
      error: summarizeOutput(entry.error),
      sandboxDecision: summarizeOutput(entry.sandboxDecision),
      promptToolSnapshot: summarizeOutput(entry.promptToolSnapshot, 2000),
    };
    this.entries.push(sanitized);
    this.onEntry?.(sanitized);
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
