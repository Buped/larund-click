// Reusable email templates. Pure, localStorage-backed store (per user) plus a few
// built-in starters so the composer is useful immediately. No network I/O here —
// the composer/EmailPage fill a template into an EmailDraft and the existing Gmail
// tools do the send/draft. Placeholders use {{name}} syntax and survive filling
// when no value is supplied, so the user can finish them by hand.

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** Placeholder names found in subject/body (derived, e.g. ["név", "cég"]). */
  placeholders: string[];
  /** Built-in starters can't be deleted, only copied. */
  builtin?: boolean;
  updatedAt: string;
}

const KEY_PREFIX = 'larund_email_templates:';
const PLACEHOLDER_RE = /\{\{\s*([^}]+?)\s*\}\}/g;

function storageKey(userId: string): string {
  return `${KEY_PREFIX}${userId || 'local'}`;
}

function newId(): string {
  return `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Unique placeholder names (in first-seen order) across subject + body. */
export function extractPlaceholders(subject: string, body: string): string[] {
  const seen = new Set<string>();
  for (const text of [subject, body]) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const name = m[1].trim();
      if (name) seen.add(name);
    }
  }
  return [...seen];
}

/** Replace {{placeholder}} with provided values; unfilled placeholders stay as-is. */
export function fillTemplate(
  tpl: Pick<EmailTemplate, 'subject' | 'body'>,
  values: Record<string, string> = {},
): { subject: string; body: string } {
  const sub = (text: string) =>
    text.replace(PLACEHOLDER_RE, (full, raw: string) => {
      const v = values[String(raw).trim()];
      return v != null && v !== '' ? v : full;
    });
  return { subject: sub(tpl.subject), body: sub(tpl.body) };
}

// ── Built-in starters (Hungarian business defaults) ────────────────────────────

const BUILTINS: ReadonlyArray<Omit<EmailTemplate, 'placeholders' | 'updatedAt'>> = [
  {
    id: 'builtin-followup',
    name: 'Follow-up (emlékeztető)',
    builtin: true,
    subject: 'Emlékeztető: {{téma}}',
    body: 'Szia {{név}},\n\ncsak egy rövid emlékeztető a korábbi levelemhez ({{téma}}). Megnézted már? Szívesen segítek, ha bármi kérdés merült fel.\n\nÜdv,\n{{aláírás}}',
  },
  {
    id: 'builtin-offer',
    name: 'Ajánlat',
    builtin: true,
    subject: 'Ajánlat — {{cég}}',
    body: 'Kedves {{név}},\n\nköszönöm az érdeklődést! Az alábbi ajánlatot állítottam össze:\n\n- **Szolgáltatás:** {{szolgáltatás}}\n- **Ár:** {{ár}}\n- **Határidő:** {{határidő}}\n\nHa megfelel, jelezz vissza, és elindítjuk. Kérdés esetén állok rendelkezésre.\n\nÜdvözlettel,\n{{aláírás}}',
  },
  {
    id: 'builtin-intro',
    name: 'Bemutatkozó',
    builtin: true,
    subject: 'Bemutatkozás — {{cég}}',
    body: 'Kedves {{név}},\n\n{{cég}} vagyok, és abban segítünk, hogy {{érték}}. Szívesen mesélnék róla pár percben — mikor lenne alkalmas egy rövid hívás a héten?\n\nÜdv,\n{{aláírás}}',
  },
];

function hydrate(t: Omit<EmailTemplate, 'placeholders' | 'updatedAt'> & { updatedAt?: string }): EmailTemplate {
  return {
    ...t,
    placeholders: extractPlaceholders(t.subject, t.body),
    updatedAt: t.updatedAt ?? new Date(0).toISOString(),
  };
}

function readStored(userId: string): EmailTemplate[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EmailTemplate[];
    return Array.isArray(parsed) ? parsed.map((t) => hydrate(t)) : [];
  } catch {
    return [];
  }
}

function writeStored(userId: string, templates: EmailTemplate[]): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(templates.filter((t) => !t.builtin)));
  } catch { /* storage may be unavailable */ }
}

/** Built-ins first, then the user's saved templates (newest first). */
export function listTemplates(userId: string): EmailTemplate[] {
  const builtins = BUILTINS.map(hydrate);
  const stored = readStored(userId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...builtins, ...stored];
}

/**
 * Create or update a template. Pass an `id` of an existing user template to update
 * it; omit it (or pass a builtin id) to create a new user template.
 */
export function saveTemplate(
  userId: string,
  input: { id?: string; name: string; subject: string; body: string },
): EmailTemplate {
  const stored = readStored(userId);
  const existingIdx = input.id ? stored.findIndex((t) => t.id === input.id) : -1;
  const tpl: EmailTemplate = {
    id: existingIdx >= 0 ? stored[existingIdx].id : newId(),
    name: input.name.trim() || 'Névtelen sablon',
    subject: input.subject,
    body: input.body,
    placeholders: extractPlaceholders(input.subject, input.body),
    updatedAt: new Date().toISOString(),
  };
  if (existingIdx >= 0) stored[existingIdx] = tpl;
  else stored.push(tpl);
  writeStored(userId, stored);
  return tpl;
}

/** Remove a user template (built-ins are ignored). Returns the remaining list. */
export function deleteTemplate(userId: string, id: string): EmailTemplate[] {
  const stored = readStored(userId).filter((t) => t.id !== id);
  writeStored(userId, stored);
  return listTemplates(userId);
}
