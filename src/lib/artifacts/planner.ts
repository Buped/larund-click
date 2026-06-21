import type { ArtifactKind, ArtifactPlan } from './types';
import { selectArtifactTemplate } from './templates';

export function detectPrimaryArtifactKind(request: string): ArtifactKind {
  const text = request.toLowerCase();
  if (/\b(pptx|deck|slide|slides|prezent[aá]ci[oó]|diavet[ií]t[eé]s|dia)\b/.test(text)) return 'pptx';
  if (/\b(docx|word|szerkeszthet[oő]|szerz[oő]d[eé]s)\b/.test(text)) return 'docx';
  if (/\b(xlsx|excel|t[aá]bl[aá]zat|spreadsheet)\b/.test(text)) return 'xlsx';
  if (/\b(csv)\b/.test(text)) return 'csv';
  if (/\b(html)\b/.test(text)) return 'html';
  return 'pdf';
}

export function planArtifact(request: string, references: string[] = []): ArtifactPlan {
  const primaryKind = detectPrimaryArtifactKind(request);
  const secondaryKinds: ArtifactKind[] = [];
  const text = request.toLowerCase();
  if (primaryKind !== 'pdf' && /\bpdf\b/.test(text)) secondaryKinds.push('pdf');
  if (primaryKind !== 'docx' && /\b(docx|word)\b/.test(text)) secondaryKinds.push('docx');
  if (primaryKind !== 'pptx' && /\b(pptx|deck|prezent[aá]ci[oó])\b/.test(text)) secondaryKinds.push('pptx');
  const template = selectArtifactTemplate(primaryKind, request);
  const expectedText = [
    ...new Set([
      ...references.map((ref) => ref.trim()).filter(Boolean),
      request.match(/Larund Click/i)?.[0],
      request.match(/Kov[aá]cs P[eé]ter/i)?.[0],
      request.match(/\b\d{3,}\b/)?.[0],
    ].filter(Boolean) as string[]),
  ];
  return {
    title: inferTitle(request),
    primaryKind,
    secondaryKinds,
    templateId: template.id,
    expectedText,
    notes: [
      'Create a structured source model before rendering.',
      'Save outputs in local artifact storage.',
      'Run artifact.verify before task.complete.',
    ],
  };
}

function inferTitle(request: string): string {
  const normalized = request.trim().replace(/\s+/g, ' ');
  if (!normalized) return 'Generated artifact';
  const withoutLead = normalized.replace(/^(k[eé]sz[ií]ts|csin[aá]lj|generate|create|write)\s+/i, '');
  return withoutLead.slice(0, 80);
}
