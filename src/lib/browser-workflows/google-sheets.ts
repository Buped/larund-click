// Google Sheets (web) workflow helpers. A Google Sheet is a *cloud* document — it
// is NOT the same as the local sheet.write tool. These helpers build the data to
// paste, generate sample rows when the user asked for "N rows", and recognise the
// task so the loop can route it to the browser/connection path.

export function isGoogleSheetsTask(text: string): boolean {
  return (
    /google\s*(táblá|sheet|spreadsheet)/i.test(text) ||
    /sheets\.new/i.test(text) ||
    /docs\.google\.com\/spreadsheets/i.test(text) ||
    /google\s*táblázat/i.test(text)
  );
}

/** Build a TSV blob suitable for a single clipboard paste into a sheet grid. */
export function buildTsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => String(c ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
}

/**
 * Generate `count` plausible sample rows (with a header) when the user asked for
 * "at least N rows" but didn't supply data. Avoids needlessly asking the user.
 */
export function sampleRows(count: number, headers?: string[]): string[][] {
  const head = headers && headers.length ? headers : ['Név', 'Email', 'Státusz'];
  const firstNames = ['Kovács János', 'Nagy Anna', 'Szabó Péter', 'Tóth Eszter', 'Horváth Gábor', 'Kiss Júlia', 'Varga Dávid', 'Molnár Katalin'];
  const statuses = ['Aktív', 'Függőben', 'Lezárt'];
  const rows: string[][] = [head];
  for (let i = 0; i < count; i++) {
    const name = firstNames[i % firstNames.length];
    const email = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.') + '@example.com';
    rows.push([name, email, statuses[i % statuses.length]]);
  }
  return rows;
}

/**
 * Best-effort check that a sheet read-back actually contains pasted data. We
 * cannot fully introspect the canvas grid over CDP, but if the page text contains
 * several of our values it is strong evidence the paste landed.
 */
export function readBackContains(readOutput: string, expectedValues: string[]): boolean {
  const text = (readOutput ?? '').toLowerCase();
  const hits = expectedValues.filter((v) => v && text.includes(v.toLowerCase())).length;
  return hits >= Math.min(2, expectedValues.length);
}

export const A1_FOCUS_HINT =
  'On a fresh sheets.new sheet cell A1 is already active. If you are unsure the grid is focused, ask the user to click A1 and reply "kész", then paste.';
