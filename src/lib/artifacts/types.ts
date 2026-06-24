export type ArtifactKind =
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'xlsx'
  | 'csv'
  | 'html'
  | 'markdown'
  | 'image'
  | 'bundle';

export interface ArtifactFile {
  id: string;
  label: string;
  path: string;
  mimeType: string;
  sizeBytes?: number;
  role: 'source' | 'output' | 'preview' | 'log';
}

export interface ArtifactVerification {
  exists: boolean;
  readable: boolean;
  pageCount?: number;
  slideCount?: number;
  wordCount?: number;
  containsExpectedText?: string[];
  warnings: string[];
  errors: string[];
}

export interface ArtifactManifest {
  id: string;
  workspaceId?: string;
  taskId?: string;
  title: string;
  kind: ArtifactKind;
  requestedBy: 'chat' | 'automation' | 'workflow';
  createdAt: string;
  updatedAt: string;
  status: 'planning' | 'rendering' | 'ready' | 'failed' | 'blocked';
  sourceFiles: ArtifactFile[];
  outputFiles: ArtifactFile[];
  previewFiles: ArtifactFile[];
  templateId?: string;
  designProfile?: string;
  verification: ArtifactVerification;
  metadata: Record<string, unknown>;
}

export interface BrandTheme {
  name?: string;
  logoPath?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  surface?: string;
  text?: string;
  mutedText?: string;
  fontFamily?: string;
}

export interface ArtifactTable {
  id: string;
  title?: string;
  columns: string[];
  rows: string[][];
  totalRow?: string[];
}

export interface ArtifactChart {
  id: string;
  type: 'bar' | 'line' | 'pie' | 'donut';
  title?: string;
  labels: string[];
  values: number[];
}

export interface ArtifactAsset {
  id: string;
  path: string;
  mimeType?: string;
  alt?: string;
}

/** One inline run of styled text inside a paragraph or list item. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Hex color, e.g. "#EE7E3A". */
  color?: string;
  /** Turns the run into a hyperlink. */
  link?: string;
}

/** A list item; may carry styled runs and nested sub-items (max ~2-3 deep). */
export interface ListItem {
  text?: string;
  runs?: TextRun[];
  children?: ListItem[];
}

export type DocumentSection =
  | { type: 'cover'; title: string; subtitle?: string; kicker?: string; summary?: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  // A paragraph is either plain `text` or styled `runs` (runs win when present).
  | { type: 'paragraph'; text?: string; runs?: TextRun[] }
  | { type: 'list'; ordered?: boolean; items: ListItem[] }
  | { type: 'callout'; tone: 'info' | 'warning' | 'success' | 'premium'; title?: string; text: string }
  | { type: 'table'; tableId: string }
  | { type: 'image'; assetId: string; caption?: string }
  | { type: 'two_column'; left: DocumentSection[]; right: DocumentSection[] }
  | { type: 'metrics'; items: Array<{ label: string; value: string; note?: string }> }
  | { type: 'divider' }
  | { type: 'page_break' };

export interface DocumentArtifactModel {
  title: string;
  subtitle?: string;
  language: 'hu' | 'en' | string;
  format: 'pdf' | 'docx' | 'html' | 'multi';
  page: {
    size: 'A4' | 'Letter' | '16:9' | 'custom';
    orientation: 'portrait' | 'landscape';
    margins?: string;
  };
  brand?: BrandTheme;
  sections: DocumentSection[];
  tables?: ArtifactTable[];
  charts?: ArtifactChart[];
  assets?: ArtifactAsset[];
  /** Running header text (top of every page). */
  header?: string;
  footer?: string;
  /** Show "page X / Y" in the footer area. */
  pageNumbers?: boolean;
  /** Render a table of contents from the heading structure. When omitted, a TOC is
   *  auto-generated for documents with 3+ level-1 headings. */
  toc?: boolean;
}

export type SlideModel =
  | { type: 'title'; title: string; subtitle?: string; kicker?: string }
  | { type: 'bullets'; title: string; bullets: string[]; note?: string }
  | { type: 'cards'; title: string; cards: Array<{ title: string; body: string; icon?: string }> }
  | { type: 'timeline'; title: string; steps: Array<{ label: string; title: string; body: string }> }
  | { type: 'quote'; quote: string; author?: string }
  | { type: 'comparison'; title: string; columns: string[]; rows: string[][] }
  | { type: 'metrics'; title: string; items: Array<{ label: string; value: string; note?: string }> }
  | { type: 'closing'; title: string; subtitle?: string };

export interface PresentationArtifactModel {
  title: string;
  subtitle?: string;
  language: 'hu' | 'en' | string;
  aspectRatio: '16:9' | '4:3';
  brand?: BrandTheme;
  slides: SlideModel[];
}

export interface ArtifactTemplate {
  id: string;
  name: string;
  kind: ArtifactKind[];
  category: 'report' | 'invoice' | 'proposal' | 'deck' | 'contract' | 'one_pager' | 'generic';
  style: 'minimal' | 'premium_dark' | 'corporate' | 'modern_light' | 'technical' | 'financial' | 'legal';
  description: string;
  supports: {
    pdf: boolean;
    docx: boolean;
    pptx: boolean;
    html: boolean;
  };
  files: {
    html?: string;
    css?: string;
    pptxTheme?: string;
    docxReference?: string;
  };
}

export interface ArtifactPlan {
  title: string;
  primaryKind: ArtifactKind;
  secondaryKinds: ArtifactKind[];
  templateId: string;
  expectedText: string[];
  notes: string[];
}
