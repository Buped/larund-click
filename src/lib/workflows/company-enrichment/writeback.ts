import type { ControlAction, SheetUpdateCell } from '../../control-system/types';
import type { CompanyEnrichmentField, EnrichmentResult, SheetSnapshot } from './types';
import { findColumn } from './planner';

const DEFAULT_LABELS: Record<CompanyEnrichmentField, string> = {
  website: 'Weboldal linkje',
  email: 'Email cime',
  phone: 'Telefon szam',
  industry: 'Iparag',
  linkedin: 'LinkedIn',
  source_url: 'Forras URL',
  confidence: 'Bizonyossag',
  notes: 'Megjegyzes',
};

export function buildWritebackCells(snapshot: SheetSnapshot, targetFields: CompanyEnrichmentField[], results: EnrichmentResult[]): { header: string[]; cells: SheetUpdateCell[] } {
  const header = [...snapshot.header];
  const columnByField = new Map<CompanyEnrichmentField, number>();
  for (const field of targetFields) {
    const label = DEFAULT_LABELS[field];
    let index = findColumn(header, field);
    if (index < 0) index = findColumn(header, label);
    if (index < 0) {
      header.push(label);
      index = header.length - 1;
    }
    columnByField.set(field, index + 1);
  }
  const cells: SheetUpdateCell[] = [];
  header.forEach((value, index) => {
    if ((snapshot.header[index] ?? '') !== value) cells.push({ row: 1, column: index + 1, value });
  });
  for (const result of results) {
    for (const field of targetFields) {
      const value = result.values[field];
      if (value === undefined) continue;
      const column = columnByField.get(field);
      if (column) cells.push({ row: result.rowIndex, column, value });
    }
  }
  return { header, cells };
}

export function writebackAction(path: string, sheet: string | undefined, cells: SheetUpdateCell[]): ControlAction {
  return {
    action: 'sheet.update_cells',
    path,
    sheet,
    cells,
    preserveExisting: true,
    backup: true,
    policy: 'roundtrip_with_backup',
  };
}
