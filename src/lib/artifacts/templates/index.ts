import type { ArtifactKind, ArtifactTemplate } from '../types';

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  {
    id: 'premium-dark-report',
    name: 'Premium Dark Report',
    kind: ['pdf', 'html'],
    category: 'report',
    style: 'premium_dark',
    description: 'Dark editorial report with strong headings, orange accent, metric cards and polished tables.',
    supports: { pdf: true, docx: false, pptx: false, html: true },
    files: { html: 'premium-dark-report/template.html', css: 'premium-dark-report/styles.css' },
  },
  {
    id: 'modern-light-report',
    name: 'Modern Light Report',
    kind: ['pdf', 'docx', 'html'],
    category: 'report',
    style: 'modern_light',
    description: 'Clean light business report with airy spacing and readable tables.',
    supports: { pdf: true, docx: true, pptx: false, html: true },
    files: { html: 'modern-light-report/template.html', css: 'modern-light-report/styles.css' },
  },
  {
    id: 'invoice-blue-corporate',
    name: 'Blue Corporate Invoice',
    kind: ['pdf', 'docx', 'html'],
    category: 'invoice',
    style: 'financial',
    description: 'Professional invoice layout with issuer/client header, line items, VAT and total block.',
    supports: { pdf: true, docx: true, pptx: false, html: true },
    files: { html: 'invoice-blue-corporate/template.html', css: 'invoice-blue-corporate/styles.css' },
  },
  {
    id: 'invoice-green-minimal',
    name: 'Green Minimal Invoice',
    kind: ['pdf', 'docx', 'html'],
    category: 'invoice',
    style: 'minimal',
    description: 'Minimal invoice with calm green accent and compact totals.',
    supports: { pdf: true, docx: true, pptx: false, html: true },
    files: { html: 'invoice-green-minimal/template.html', css: 'invoice-green-minimal/styles.css' },
  },
  {
    id: 'pitch-deck-dark',
    name: 'Pitch Deck Dark',
    kind: ['pptx'],
    category: 'deck',
    style: 'premium_dark',
    description: 'Dark 16:9 deck theme with bold title slides, cards and timeline layouts.',
    supports: { pdf: false, docx: false, pptx: true, html: false },
    files: { pptxTheme: 'pitch-deck-dark/theme.json' },
  },
  {
    id: 'pitch-deck-light',
    name: 'Pitch Deck Light',
    kind: ['pptx'],
    category: 'deck',
    style: 'modern_light',
    description: 'Light 16:9 deck theme for concise business presentations.',
    supports: { pdf: false, docx: false, pptx: true, html: false },
    files: { pptxTheme: 'pitch-deck-light/theme.json' },
  },
  {
    id: 'proposal-modern',
    name: 'Modern Proposal',
    kind: ['pdf', 'docx', 'html'],
    category: 'proposal',
    style: 'corporate',
    description: 'Proposal template with executive summary, scope cards, timeline and commercial table.',
    supports: { pdf: true, docx: true, pptx: false, html: true },
    files: { html: 'proposal-modern/template.html', css: 'proposal-modern/styles.css' },
  },
  {
    id: 'contract-clean-docx',
    name: 'Clean Contract DOCX',
    kind: ['docx'],
    category: 'contract',
    style: 'legal',
    description: 'Editable legal-style DOCX with conservative headings, clauses and signature area.',
    supports: { pdf: false, docx: true, pptx: false, html: false },
    files: { docxReference: 'contract-clean-docx/reference.json' },
  },
  {
    id: 'one-pager-startup',
    name: 'Startup One-Pager',
    kind: ['pdf', 'html'],
    category: 'one_pager',
    style: 'modern_light',
    description: 'Single-page overview with hero summary, metric strip and concise sections.',
    supports: { pdf: true, docx: false, pptx: false, html: true },
    files: { html: 'one-pager-startup/template.html', css: 'one-pager-startup/styles.css' },
  },
  {
    id: 'technical-spec',
    name: 'Technical Spec',
    kind: ['pdf', 'docx', 'html'],
    category: 'generic',
    style: 'technical',
    description: 'Structured technical document for requirements, architecture notes and test matrices.',
    supports: { pdf: true, docx: true, pptx: false, html: true },
    files: { html: 'technical-spec/template.html', css: 'technical-spec/styles.css' },
  },
];

export function getArtifactTemplate(id?: string): ArtifactTemplate {
  return ARTIFACT_TEMPLATES.find((template) => template.id === id) ?? ARTIFACT_TEMPLATES[0];
}

export function selectArtifactTemplate(kind: ArtifactKind, request: string): ArtifactTemplate {
  const text = request.toLowerCase();
  const category = text.match(/sz[aá]mla|invoice|d[ií]jbek[eé]r[oő]|[aá]raj[aá]nlat/)
    ? 'invoice'
    : text.match(/pitch|deck|prezent[aá]ci[oó]|slide|dia/)
      ? 'deck'
      : text.match(/proposal|aj[aá]nlat/)
        ? 'proposal'
        : text.match(/contract|szerz[oő]d[eé]s/)
          ? 'contract'
          : text.match(/one[- ]pager|egyoldalas/)
            ? 'one_pager'
            : 'report';
  const dark = text.match(/dark|s[oö]t[eé]t|premium/);
  return ARTIFACT_TEMPLATES.find((template) => (
    template.kind.includes(kind) &&
    template.category === category &&
    (!dark || template.style === 'premium_dark')
  )) ?? ARTIFACT_TEMPLATES.find((template) => template.kind.includes(kind)) ?? ARTIFACT_TEMPLATES[0];
}
