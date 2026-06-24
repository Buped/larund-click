// A compact, embedded result card for `sheet.query` aggregate output — so the AI's
// computed answers (sums, per-group totals) appear as a visual widget in chat,
// not just raw text. Matches the dark card visual language of ArtifactCard.

interface AggregateResult {
  path?: string;
  sheet?: string;
  total_rows?: number;
  matched_rows?: number;
  aggregates?: Record<string, number | string | null>;
  group_by?: string[];
  group_count?: number;
  groups?: Array<{ key: Record<string, string>; matched_rows: number; aggregates: Record<string, number | string | null> }>;
}

/** Parse a sheet.query tool output string into an aggregate result, or null. */
export function parseAggregateResult(output: string | undefined): AggregateResult | null {
  if (!output) return null;
  try {
    const parsed = JSON.parse(output) as AggregateResult;
    if (parsed && (parsed.aggregates || parsed.groups)) return parsed;
  } catch {
    /* not JSON */
  }
  return null;
}

function fmt(value: number | string | null | undefined): string {
  if (value == null) return '—';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toLocaleString('hu-HU') : value.toLocaleString('hu-HU', { maximumFractionDigits: 2 });
  }
  return String(value);
}

function prettyLabel(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AggregateResultCard({ result }: { result: AggregateResult }) {
  const grouped = Array.isArray(result.groups) && result.groups.length > 0;
  const aggKeys = grouped
    ? Object.keys(result.groups![0]?.aggregates ?? {})
    : Object.keys(result.aggregates ?? {});

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 12,
        background: 'var(--surface, rgba(255,255,255,.03))',
        padding: 14,
        marginTop: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent, #EE7E3A)' }}>
          Lekérdezés eredménye
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>
          {fmt(result.matched_rows)}{result.total_rows != null ? ` / ${fmt(result.total_rows)}` : ''} sor
        </span>
      </div>

      {!grouped && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {aggKeys.map((key) => (
            <div key={key} style={{ flex: '1 1 120px', minWidth: 110, background: 'rgba(0,0,0,.18)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>
                {fmt(result.aggregates?.[key])}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{prettyLabel(key)}</div>
            </div>
          ))}
        </div>
      )}

      {grouped && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {(result.group_by ?? Object.keys(result.groups![0]?.key ?? {})).map((col) => (
                  <th key={col} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    {prettyLabel(col)}
                  </th>
                ))}
                {aggKeys.map((key) => (
                  <th key={key} style={{ textAlign: 'right', padding: '6px 10px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                    {prettyLabel(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.groups!.slice(0, 50).map((g, i) => (
                <tr key={i}>
                  {(result.group_by ?? Object.keys(g.key)).map((col) => (
                    <td key={col} style={{ padding: '6px 10px', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>
                      {g.key[col] ?? '—'}
                    </td>
                  ))}
                  {aggKeys.map((key) => (
                    <td key={key} style={{ padding: '6px 10px', textAlign: 'right', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)' }}>
                      {fmt(g.aggregates[key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {result.group_count != null && result.group_count > 50 && (
            <div style={{ fontSize: 11, color: 'var(--text-hint)', marginTop: 6 }}>
              {fmt(result.group_count)} csoportból az első 50 látszik.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
