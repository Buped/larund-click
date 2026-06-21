import { invoke } from '@tauri-apps/api/core';
import type { ArtifactKind, ArtifactManifest, DocumentArtifactModel, PresentationArtifactModel } from './types';
import type { InvoiceArtifactModel } from './invoice';
import { planArtifact } from './planner';

export interface ArtifactRenderPdfInput {
  title: string;
  model: DocumentArtifactModel | InvoiceArtifactModel;
  templateId?: string;
  outputName?: string;
  options?: {
    pageSize?: 'A4' | 'Letter';
    landscape?: boolean;
    printBackground?: boolean;
    margins?: {
      top?: string;
      right?: string;
      bottom?: string;
      left?: string;
    };
  };
}

export interface ArtifactRenderDocxInput {
  title: string;
  model: DocumentArtifactModel;
  templateId?: string;
  outputName?: string;
}

export interface ArtifactRenderPptxInput {
  title: string;
  model: PresentationArtifactModel;
  templateId?: string;
  outputName?: string;
}

export async function renderPdfArtifact(input: ArtifactRenderPdfInput): Promise<ArtifactManifest> {
  const raw = await invoke<string>('artifact_render_pdf', {
    title: input.title,
    model: input.model,
    templateId: input.templateId ?? null,
    outputName: input.outputName ?? null,
    options: input.options ?? null,
  });
  return JSON.parse(raw) as ArtifactManifest;
}

export async function renderDocxArtifact(input: ArtifactRenderDocxInput): Promise<ArtifactManifest> {
  const raw = await invoke<string>('artifact_render_docx', {
    title: input.title,
    model: input.model,
    templateId: input.templateId ?? null,
    outputName: input.outputName ?? null,
  });
  return JSON.parse(raw) as ArtifactManifest;
}

export async function renderPptxArtifact(input: ArtifactRenderPptxInput): Promise<ArtifactManifest> {
  const raw = await invoke<string>('artifact_render_pptx', {
    title: input.title,
    model: input.model,
    templateId: input.templateId ?? null,
    outputName: input.outputName ?? null,
  });
  return JSON.parse(raw) as ArtifactManifest;
}

export async function convertArtifact(fromPath: string, to: Extract<ArtifactKind, 'pdf' | 'docx' | 'pptx' | 'html'>, outputName?: string): Promise<ArtifactManifest> {
  const raw = await invoke<string>('artifact_convert', { fromPath, to, outputName: outputName ?? null });
  return JSON.parse(raw) as ArtifactManifest;
}

export async function planArtifactAction(request: string, references?: string[]): Promise<string> {
  return JSON.stringify(planArtifact(request, references), null, 2);
}

export interface ArtifactDesignLint {
  status: 'pass' | 'warn' | 'fail';
  failures: string[];
  warnings: string[];
  checks: Array<{ id: string; ok: boolean; severity: 'fail' | 'warn'; detail: string }>;
}

export async function designLintArtifact(path: string, kind?: string, model?: unknown): Promise<ArtifactDesignLint> {
  const raw = await invoke<string>('artifact_design_lint', { path, kind: kind ?? null, model: model ?? null });
  return JSON.parse(raw) as ArtifactDesignLint;
}
