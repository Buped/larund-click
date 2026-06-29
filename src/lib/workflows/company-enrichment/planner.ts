import type { CompanyEnrichmentInput, EnrichmentWorkItem, SheetSnapshot } from './types';

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

export function findColumn(header: string[], wanted: string): number {
  const needle = normalize(wanted);
  return header.findIndex((h) => normalize(h) === needle);
}

export function buildWorkPlan(input: CompanyEnrichmentInput, snapshot: SheetSnapshot): EnrichmentWorkItem[] {
  const companyCol = findColumn(snapshot.header, input.companyNameColumn);
  if (companyCol < 0) throw new Error(`company_column_not_found:${input.companyNameColumn}`);
  const limit = input.maxRows ?? Number.POSITIVE_INFINITY;
  return snapshot.rows
    .slice(1)
    .map((row, index) => ({ row, rowIndex: index + 2 }))
    .filter(({ row }) => row[companyCol]?.trim())
    .slice(0, limit)
    .map(({ row, rowIndex }) => {
      const existingValues: Record<string, string> = {};
      const missingFields: string[] = [];
      for (const field of input.targetColumns) {
        const col = findColumn(snapshot.header, field);
        const value = col >= 0 ? row[col]?.trim() ?? '' : '';
        existingValues[field] = value;
        if (!value) missingFields.push(field);
      }
      return {
        rowIndex,
        companyName: row[companyCol].trim(),
        existingValues,
        missingFields,
        status: missingFields.length ? 'pending' : 'verified',
        attempts: 0,
        sources: [],
      };
    });
}

export function buildCompanyQueries(companyName: string, locale = 'hu'): string[] {
  const quoted = `"${companyName}"`;
  const base = [
    `${quoted} official website`,
    `${quoted} email phone`,
    `${quoted} LinkedIn`,
  ];
  if (locale.toLowerCase().startsWith('hu')) {
    base.push(`${quoted} hivatalos weboldal`, `${quoted} kapcsolat email telefon`, `${quoted} elerhetoseg`);
  }
  return base;
}
