import type { EnrichmentResult, SheetSnapshot } from './types';

export interface EnrichmentCoverage {
  totalRows: number;
  processedRows: number;
  found: number;
  notFound: number;
  ambiguous: number;
  ok: boolean;
}

export function verifyCoverage(snapshot: SheetSnapshot, results: EnrichmentResult[], allowPartial = false): EnrichmentCoverage {
  const totalRows = snapshot.rows.slice(1).filter((row) => row.some((cell) => cell.trim())).length;
  const processedRows = new Set(results.map((r) => r.rowIndex)).size;
  const found = results.filter((r) => r.status === 'found').length;
  const notFound = results.filter((r) => r.status === 'not_found').length;
  const ambiguous = results.filter((r) => r.status === 'ambiguous').length;
  return {
    totalRows,
    processedRows,
    found,
    notFound,
    ambiguous,
    ok: processedRows === totalRows && (allowPartial || ambiguous === 0),
  };
}
