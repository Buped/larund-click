import type { DocumentReference } from '../../references/types';

export type CompanyEnrichmentField =
  | 'website'
  | 'email'
  | 'phone'
  | 'industry'
  | 'linkedin'
  | 'source_url'
  | 'confidence'
  | 'notes';

export interface CompanyEnrichmentInput {
  sourceFile: DocumentReference;
  sheet?: string;
  companyNameColumn: string;
  targetColumns: CompanyEnrichmentField[];
  maxRows?: number;
  allowPartial?: boolean;
  searchMode: 'quick_web_search';
}

export interface SourceCandidate {
  url: string;
  title?: string;
  snippet?: string;
  source: 'search' | 'page' | 'contact_page' | 'linkedin' | 'registry';
  confidence: number;
  evidence: string[];
}

export interface EnrichmentWorkItem {
  rowIndex: number;
  companyName: string;
  existingValues: Record<string, string>;
  missingFields: string[];
  status: 'pending' | 'searching' | 'found' | 'not_found' | 'ambiguous' | 'written' | 'verified';
  attempts: number;
  sources: SourceCandidate[];
}

export interface EnrichmentResult {
  rowIndex: number;
  companyName: string;
  values: Partial<Record<CompanyEnrichmentField, string>>;
  sources: SourceCandidate[];
  status: 'found' | 'not_found' | 'ambiguous';
  notes?: string;
}

export interface SheetSnapshot {
  path: string;
  sheet?: string;
  rows: string[][];
  header: string[];
}
