// Detects when a new user message is a *correction / continuation* of the active
// task rather than a brand-new request. Without this, "Nem, a táblázat üres, nem
// töltötted fel" was treated as a fresh task and the agent lost the thread.

export interface CorrectionResult {
  isCorrection: boolean;
  signals: string[];
  /** A short machine interpretation used to update the active task state. */
  interpretation: string;
}

// Hungarian + English correction / continuation cues. Matched case-insensitively
// against the trimmed message. Kept deliberately broad — a false positive only
// means we continue the previous task, which is the safer default mid-thread.
const CORRECTION_PATTERNS: Array<{ re: RegExp; tag: string }> = [
  { re: /^\s*(nem|no|nope)\b/i, tag: 'negation' },
  { re: /\bez (nem|sem) (jó|az|stimmel|elég)\b/i, tag: 'not_good' },
  { re: /\bnot (good|right|correct|what)\b/i, tag: 'not_good' },
  { re: /üres/i, tag: 'empty' },
  { re: /\bempty\b/i, tag: 'empty' },
  { re: /\bnem töltötted? fel\b/i, tag: 'not_uploaded' },
  { re: /\b(did ?n'?t|not) (upload|fill|populate|create)\b/i, tag: 'not_uploaded' },
  { re: /\bnem (ezt|így|úgy) kérte?m\b/i, tag: 'not_what_asked' },
  { re: /\bnem ez(t)? (akartam|kértem)\b/i, tag: 'not_what_asked' },
  { re: /\b(még )?nincs kész\b/i, tag: 'not_done' },
  { re: /\bnot (done|finished|complete)\b/i, tag: 'not_done' },
  { re: /\bfolytasd\b/i, tag: 'continue' },
  { re: /\b(continue|keep going|carry on)\b/i, tag: 'continue' },
  { re: /\ba megnyitott\b/i, tag: 'use_open_target' },
  { re: /\bthe (open|currently open|already open)\b/i, tag: 'use_open_target' },
  { re: /\bne (lokális|helyi|local)\b/i, tag: 'forbid_local' },
  { re: /\b(not|don'?t) .*\blocal\b/i, tag: 'forbid_local' },
  { re: /\bmég mindig\b/i, tag: 'still_wrong' },
  { re: /\bstill\b.*\b(empty|wrong|not)\b/i, tag: 'still_wrong' },
  { re: /\bjavítsd\b/i, tag: 'fix' },
  { re: /\b(fix|redo|try again|próbáld újra)\b/i, tag: 'fix' },
];

export function detectCorrection(message: string): CorrectionResult {
  const signals: string[] = [];
  for (const { re, tag } of CORRECTION_PATTERNS) {
    if (re.test(message) && !signals.includes(tag)) signals.push(tag);
  }
  const isCorrection = signals.length > 0;

  let interpretation = '';
  if (isCorrection) {
    const parts: string[] = ['Continuation of the active task (not a new task).'];
    if (signals.includes('empty') || signals.includes('not_uploaded')) {
      parts.push('Previous attempt did not actually write the data; the target is still empty.');
    }
    if (signals.includes('use_open_target')) {
      parts.push('Operate on the already-open target (page/document), do not create a new one.');
    }
    if (signals.includes('forbid_local')) {
      parts.push('Do not satisfy this with a local file; use the web/cloud target.');
    }
    if (signals.includes('not_what_asked')) {
      parts.push('The chosen approach was wrong; reinterpret the original goal.');
    }
    interpretation = parts.join(' ');
  }

  return { isCorrection, signals, interpretation };
}
