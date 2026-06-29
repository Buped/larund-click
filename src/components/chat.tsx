import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ClickMark } from './icons';
import { RichMessage, VisualizationBlock } from './rich-message';
import { Sidebar } from './sidebar';
import { MODELS } from '../constants/models';
import { getMessages, addMessage, createSession, updateMessage, touchSession, getSettings, setAutoSessionTitle } from '../lib/database';
import { callOpenRouter, type ChatMessage } from '../lib/openrouter';
import {
  injectCitationMarkers,
  isDeepResearchRequest,
  parseSearchCitations,
  rememberSearchCitations,
  shouldUseWebSearch,
  type SearchCitation,
  type SearchMode,
  type WebSearchPreference,
} from '../lib/search-citations';
import { buildChatSystemPrompt } from '../lib/assistant/persona';
import { parseLarundEnvelope, parseThinking, serializeThinking, type VisibleThinking } from '../lib/assistant/thinking';
import { collectAgentVisualizations, type ChatVisualization } from '../lib/assistant/visualizations';
import { generateChatTitle } from '../lib/assistant/title';
import { runMemoryExtraction } from '../lib/memory/pipeline';
import { runAgentLoop, AgentStatus, AgentStep, AgentAbortSignal } from '../lib/agent-loop';
import { v4 as uuidv4 } from 'uuid';
import type { UserCredits } from '../lib/supabase';
import { ReferenceChip } from './chat/ReferenceChip';
import { ComposerAttachmentTray } from './chat/ComposerAttachmentTray';
import { ReferencePicker } from './chat/ReferencePicker';
import { RichMentionEditor, type RichMentionEditorHandle } from './mentions/RichMentionEditor';
import { MentionChip } from './mentions/MentionChip';
import type { DocumentReference } from '../lib/references/types';
import { deserializeReferences, serializeReferences } from '../lib/references/serialize';
import {
  mergeDocumentReferences,
  referenceKey,
  referencesFromClipboardEvent,
  referencesFromDroppedDataTransfer,
} from '../lib/references/composer-attachments';
import { ingestReferences } from '../lib/references/ingest';
import type { ReferencedContext } from '../lib/mentions/types';
import { resolveReferencedContext } from '../lib/mentions/resolve';
import { documentReferenceToMention, mentionToDocumentReference } from './mentions/mentionSerialization';
import { EmailComposerCard } from './email/EmailComposerCard';
import type { EmailDraft } from '../lib/email/types';
import { policyForAutonomyMode, type AutonomyMode as PolicyAutonomyMode } from '../lib/tools/policy';
import { classifyIntent } from '../lib/intent/classify';
import { ArtifactCard } from './artifacts/ArtifactCard';
import { AggregateResultCard, parseAggregateResult } from './artifacts/AggregateResultCard';
import { ArtifactPreviewRail } from './artifacts/ArtifactPreviewRail';
import {
  dedupeArtifacts,
  manifestToChatArtifact,
  parseArtifactManifest as parseManifestOutput,
  type ArtifactPreviewState,
  type ChatArtifactAttachment,
} from '../lib/artifacts/ui';
import type { CodeRunDetails, CodeRunFile } from '../lib/code-exec/types';
import {
  buildAnswerModelMetadata,
  citationsToWebCitations,
  isAnswerModelMetadata,
  isWebCitation,
  isWebSearchRun,
  isWebSource,
  parseJsonArray,
  parseJsonObject,
  searchRunFromChat,
  sourcesFromSearchCitations,
  verifyWebAnswerQuality,
  webMetadataFromAgentSteps,
  type AnswerModelMetadata,
  type WebCitation,
  type WebSearchRun,
  type WebSource,
} from '../lib/web-search/metadata';
import { explicitWebRequested, routeWebSearch, type WebSearchRouteDecision } from '../lib/web-search/web-search-router';
import { evaluateSearchEvidence, type SearchEvidence } from '../lib/web-search/quality';

/** Read and clear the one-shot workflow template armed on the Workflows page. */
function consumeActiveWorkflowTemplate(): string | undefined {
  const id = localStorage.getItem('active_workflow_template_id');
  if (id) localStorage.removeItem('active_workflow_template_id');
  return id ?? undefined;
}

function mergeTaskReferences(inlineRefs: ReferencedContext[], attachmentRefs: DocumentReference[]): ReferencedContext[] {
  const seen = new Set<string>();
  const out: ReferencedContext[] = [];
  const push = (ref: ReferencedContext) => {
    const key = taskReferenceKey(ref);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  inlineRefs.forEach(push);
  attachmentRefs.map(documentReferenceToMention).forEach(push);
  return out;
}

function taskReferenceKey(ref: ReferencedContext): string {
  const doc = mentionToDocumentReference(ref);
  return doc ? referenceKey(doc) : `${ref.kind}:${ref.refId}`.toLowerCase();
}

// ─── Model picker ─────────────────────────────────────────────────────────────

function InlineModelPicker({ model, setModel }: { model: string; setModel: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const cur = MODELS.find(m => m.id === model) || MODELS[1];

  function updatePopoverPosition() {
    const trigger = ref.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 10;
    const viewportPad = 12;
    const width = Math.min(282, Math.max(220, window.innerWidth - viewportPad * 2));
    const height = popoverRef.current?.offsetHeight ?? 238;
    const maxLeft = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    const left = Math.min(Math.max(rect.left, viewportPad), maxLeft);
    const topAbove = rect.top - height - gap;
    const top = topAbove >= viewportPad
      ? topAbove
      : Math.min(rect.bottom + gap, Math.max(viewportPad, window.innerHeight - height - viewportPad));

    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width,
      zIndex: 1000,
      pointerEvents: 'auto',
    });
  }

  useEffect(() => {
    if (!open) return;
    updatePopoverPosition();

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onReposition = () => updatePopoverPosition();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) updatePopoverPosition();
  }, [open, model]);

  const pickerPopover = open && popoverStyle ? createPortal(
    <div
      ref={popoverRef}
      className="model-popover popover-in"
      style={popoverStyle}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="sec-label model-popover-title">Model</div>
      {MODELS.map(m => {
        const active = m.id === model;
        return (
          <button
            key={m.id}
            className={`model-option${active ? ' model-option--active' : ''}`}
            onClick={() => { setModel(m.id); setOpen(false); }}
          >
            <span className="model-option-icon">
              <Icon name={m.icon} size={14} stroke={1.5} />
            </span>
            <span className="model-option-main">
              <span className="model-option-line">
                <span className="model-option-name">{m.name}</span>
                <span className="model-option-tag">- {m.tag}</span>
              </span>
              <span className="model-option-desc">{m.desc}</span>
            </span>
            <span className="model-option-cost">{m.cost}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }}>
      <button
        onClick={() => {
          const nextOpen = !open;
          if (nextOpen) updatePopoverPosition();
          setOpen(nextOpen);
        }}
        className="composer-pill composer-pill--active"
        style={{ fontSize: 12.5 }}
      >
        <Icon name={cur.icon} size={13} stroke={1.6} style={{ color: 'var(--accent)' }} />
        <span style={{ fontWeight: 600 }}>{cur.name}</span>
        <Icon
          name="chevronDown" size={11} stroke={1.6}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </button>

      {pickerPopover}

      {false && open && (
        <div
          className="fade-up"
          style={{
            position: 'absolute', bottom: 'calc(100% + 10px)', left: 0,
            width: 250, background: 'var(--bg-elevated)',
            border: '1px solid var(--border-md)', borderRadius: 12, padding: 6,
            boxShadow: '0 -24px 60px -10px rgba(0,0,0,.75)', zIndex: 30,
          }}
        >
          <div className="sec-label" style={{ padding: '5px 10px 8px' }}>Model</div>
          {MODELS.map(m => {
            const active = m.id === model;
            return (
              <button
                key={m.id}
                onClick={() => { setModel(m.id); setOpen(false); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 10px', borderRadius: 8, border: 'none', textAlign: 'left',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: active ? 'var(--bg-blue-row)' : 'transparent',
                  transition: 'background .1s',
                }}
                onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = active ? 'var(--bg-blue-row)' : 'transparent'; }}
              >
                <span style={{
                  width: 30, height: 30, borderRadius: 8, flex: 'none',
                  display: 'grid', placeItems: 'center',
                  background: active ? 'var(--accent)' : 'rgba(var(--ov-color),0.06)',
                  color: active ? 'var(--on-accent)' : 'var(--text-muted)',
                }}>
                  <Icon name={m.icon} size={14} stroke={1.5} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {m.tag}</span>
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-hint)', display: 'block', marginTop: 1 }}>{m.desc}</span>
                </span>
                <span style={{ fontSize: 10.5, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', flex: 'none' }}>{m.cost}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Message components ───────────────────────────────────────────────────────

function chatInitials(email?: string | null): string {
  if (!email) return 'U';
  const local = email.split('@')[0];
  const parts = local.split(/[._\-]/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return local.slice(0, 2).toUpperCase();
}

/** Circular AI avatar with the Larund lightning mark — matches the design's
 *  gradient-disc agent avatar. */
function AiAvatar({ running }: { running?: boolean }) {
  return (
    <div className="msg-avatar msg-avatar--ai">
      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" style={{ filter: running ? 'drop-shadow(0 0 5px rgba(var(--accent-rgb),0.6))' : 'none' }}>
        <path d="M13 2L4.5 13.5H11L9.5 22L19.5 9.5H12.5L13 2Z" fill="var(--accent)" />
      </svg>
    </div>
  );
}

function UserMsg({ children, initials = 'U' }: { children: React.ReactNode; initials?: string }) {
  return (
    <div className="msg-user-row">
      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div className="msg-user-bubble">{children}</div>
      </div>
      <div className="msg-avatar msg-avatar--user">{initials}</div>
    </div>
  );
}

function ThinkingDisclosure({ thinking, running }: { thinking?: VisibleThinking; running?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!thinking?.content.trim()) return null;
  return (
    <div className={`thinking-disclosure${open ? ' thinking-disclosure--open' : ''}`}>
      <button type="button" className="thinking-disclosure__trigger" onClick={() => setOpen((value) => !value)}>
        <Icon name="chevronDown" size={12} stroke={1.8} className="thinking-disclosure__chevron" />
        <span>THINKING</span>
        {running && <span className="dot dot-blue dot-pulse" style={{ width: 5, height: 5 }} />}
      </button>
      {open && (
        <div className="thinking-disclosure__body">
          <RichMessage content={thinking.content} />
        </div>
      )}
    </div>
  );
}

function AgentMsg({ children, rich, thinking, streaming, userId, citations = [], sources = [], modelMetadata }: {
  children?: React.ReactNode;
  rich?: string;
  thinking?: VisibleThinking;
  streaming?: boolean;
  userId?: string;
  citations?: SearchCitation[];
  sources?: WebSource[];
  modelMetadata?: AnswerModelMetadata;
}) {
  return (
    <div className="msg-ai-row">
      <AiAvatar />
      <div className="msg-ai-body">
        {rich != null ? (
          <>
            <ThinkingDisclosure thinking={thinking} running={streaming} />
            <RichMessage content={rich} userId={userId} citations={citations} sources={sources} modelMetadata={modelMetadata} />
            {streaming && <span className="streaming-cursor" />}
          </>
        ) : children}
      </div>
    </div>
  );
}

// ─── Starter cards ────────────────────────────────────────────────────────────

const STARTERS = [
  { cat: 'AUTOMATE', label: 'Reply to my unread emails',      prompt: 'Open my inbox and reply to unread emails from today.' },
  { cat: 'ORGANIZE', label: 'Sort and clean my Desktop',      prompt: 'Organise my Desktop by sorting files into project folders.' },
  { cat: 'BROWSE',   label: 'Fill out a web form for me',     prompt: 'Open a web form and fill it out using my saved details.' },
  { cat: 'RESEARCH', label: 'Research a topic and summarise', prompt: 'Research and summarise information about a topic for me.' },
  { cat: 'EXPORT',   label: 'Export data to a PDF file',      prompt: 'Export data from a dashboard or app into a PDF file.' },
  { cat: 'PLAN',     label: 'Summarise my calendar events',   prompt: "Open my calendar and summarise today's and tomorrow's events." },
];

function NewChatPanel({ onStarter }: { onStarter: (p: string) => void }) {
  return (
    <div className="new-chat-panel">
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <ClickMark size={48} radius={15} glow />
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26, fontWeight: 600, color: 'var(--text-primary)',
              letterSpacing: '-.03em', marginBottom: 8, lineHeight: 1.2,
            }}>
              How can I help you?
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 360 }}>
              Describe a task and Larund Click will handle it on your computer.
            </div>
          </div>
        </div>

        <div className="starter-grid">
          {STARTERS.map((s, i) => (
            <button key={i} className="starter-card" onClick={() => onStarter(s.prompt)}>
              <span className="starter-card-cat">{s.cat}</span>
              <span className="starter-card-label">{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Agent step rendering ─────────────────────────────────────────────────────

// Icons keyed by the no-mouse ControlAction names (see control-system/types.ts).
// Unknown / unlisted actions fall back to 'circle'.
const TOOL_ICONS: Record<string, string> = {
  'cli.run':           'command',
  'process.start':     'command',
  'process.status':    'command',
  'process.kill':      'command',
  'code.execute':      'cpu',
  'code.install_package': 'upload',
  'visualization.render': 'image',
  'file.read':         'fileText',
  'file.write':        'upload',
  'file.edit':         'upload',
  'file.list':         'folder',
  'file.tree':         'folder',
  'file.search':       'folder',
  'file.mkdir':        'folder',
  'file.copy':         'folder',
  'file.move':         'folder',
  'file.delete':       'folder',
  'document.read':     'fileText',
  'document.read_many':'fileText',
  'document.summarize':'fileText',
  'folder.scan':       'folder',
  'folder.read_relevant': 'folder',
  'sheet.read':        'fileText',
  'sheet.write':       'upload',
  'sheet.update_cells': 'upload',
  'sheet.append':      'upload',
  'sheet.export_csv':  'upload',
  'sheet.to_json':     'fileText',
  'doc.read':          'fileText',
  'doc.write_txt':     'upload',
  'doc.write_docx':    'upload',
  'artifact.plan':     'fileText',
  'artifact.render_pdf': 'fileText',
  'artifact.render_docx': 'fileText',
  'artifact.render_pptx': 'fileText',
  'artifact.convert':  'upload',
  'artifact.preview':  'fileText',
  'artifact.verify':   'check',
  'artifact.list':     'folder',
  'artifact.open':     'externalLink',
  'artifact.copy_to':  'folder',
  'artifact.pdf_extract_text': 'fileText',
  'artifact.pdf_metadata': 'fileText',
  'artifact.pdf_page_count': 'check',
  'clipboard.get':     'fileText',
  'clipboard.set':     'upload',
  'app.open':          'externalLink',
  'window.focus':      'monitor',
  'window.list':       'monitor',
  'browser.open':      'externalLink',
  'browser.read':      'fileText',
  'browser.get_state': 'monitor',
  'browser.click':     'command',
  'browser.type':      'command',
  'browser.key':       'command',
  'browser.shortcut':  'command',
  'browser.paste':     'upload',
  'browser.wait':      'clock',
  'browser.assert_text': 'check',
  'browser.assert_url':  'check',
  'browser.extract_table': 'fileText',
  'browser.download':  'fileText',
  'browser.upload':    'upload',
  'browser.login':     'lock',
  'web.search':        'search',
  'web.batch_search':  'search',
  'web.open_result':   'externalLink',
  'web.extract_page':  'fileText',
  'web.extract_contact_info': 'fileText',
  'web.verify_source': 'check',
  'connection.call':   'externalLink',
  'skill.run':         'sparkle',
  'workflow.start':    'monitor',
  'approval.request':  'sparkle',
  'task.complete':     'check',
  'ask_user':          'sparkle',
};

// Human-friendly labels for tool calls, so the step list reads like work being
// done rather than raw tool names. The raw name + JSON stays available on expand.
const TOOL_LABELS: Record<string, string> = {
  'cli.run': 'Running command',
  'process.start': 'Starting process',
  'code.execute': 'Running Python',
  'code.install_package': 'Installing Python package',
  'visualization.render': 'Rendering visualization',
  'file.read': 'Reading file',
  'file.write': 'Writing file',
  'file.edit': 'Editing file',
  'file.list': 'Listing files',
  'file.search': 'Searching files',
  'document.read': 'Reading document',
  'document.read_many': 'Reading documents',
  'document.summarize': 'Summarizing document',
  'folder.scan': 'Scanning folder',
  'folder.read_relevant': 'Reading folder',
  'sheet.read': 'Reading sheet',
  'sheet.write': 'Writing sheet',
  'sheet.update_cells': 'Updating cells',
  'sheet.append': 'Appending to sheet',
  'doc.write_docx': 'Writing document',
  'artifact.plan': 'Planning artifact',
  'artifact.render_pdf': 'Rendering PDF',
  'artifact.render_docx': 'Rendering Word document',
  'artifact.render_pptx': 'Rendering presentation',
  'artifact.convert': 'Converting artifact',
  'artifact.preview': 'Preparing preview',
  'artifact.verify': 'Verifying artifact',
  'artifact.list': 'Listing artifacts',
  'artifact.open': 'Opening artifact',
  'artifact.copy_to': 'Saving copy',
  'artifact.pdf_extract_text': 'Reading PDF text',
  'artifact.pdf_metadata': 'Reading PDF metadata',
  'artifact.pdf_page_count': 'Counting PDF pages',
  'app.open': 'Opening app',
  'window.focus': 'Focusing window',
  'browser.open': 'Opening page',
  'browser.read': 'Reading page',
  'browser.get_state': 'Reading page',
  'browser.click': 'Clicking',
  'browser.type': 'Filling form',
  'browser.paste': 'Pasting',
  'browser.wait': 'Waiting for page',
  'browser.assert_text': 'Verifying page',
  'browser.assert_url': 'Verifying page',
  'browser.extract_table': 'Extracting table',
  'browser.download': 'Downloading',
  'browser.upload': 'Uploading',
  'browser.login': 'Signing in',
  'web.search': 'Searching web',
  'web.batch_search': 'Searching web',
  'web.open_result': 'Opening result',
  'web.extract_page': 'Reading source',
  'web.extract_contact_info': 'Extracting contact info',
  'web.verify_source': 'Verifying source',
  'connection.call': 'Using connection',
  'skill.run': 'Running skill',
  'workflow.start': 'Starting workflow',
  'approval.request': 'Asking approval',
  'task.complete': 'Finishing up',
  'ask_user': 'Needs your help',
};

interface ArtifactCardManifest {
  title?: string;
  kind?: string;
  outputFiles?: Array<{ label?: string; path?: string; mimeType?: string; sizeBytes?: number }>;
  previewFiles?: Array<{ path?: string }>;
  verification?: { exists?: boolean; readable?: boolean; pageCount?: number; slideCount?: number; containsExpectedText?: string[]; errors?: string[] };
}

function parseArtifactManifest(raw: string): ArtifactCardManifest | null {
  try {
    const parsed = JSON.parse(raw) as ArtifactCardManifest;
    return Array.isArray(parsed.outputFiles) && parsed.verification ? parsed : null;
  } catch {
    return null;
  }
}

function ArtifactResultCard({ manifest }: { manifest: ArtifactCardManifest }) {
  const output = manifest.outputFiles?.[0];
  const checks = [
    manifest.verification?.exists ? 'exists' : undefined,
    manifest.verification?.readable ? 'readable' : undefined,
    manifest.verification?.pageCount ? `${manifest.verification.pageCount} page(s)` : undefined,
    manifest.verification?.slideCount ? `${manifest.verification.slideCount} slide(s)` : undefined,
  ].filter(Boolean);
  return (
    <div style={{
      margin: '4px 0 8px 24px',
      border: '1px solid var(--border-md)',
      borderRadius: 8,
      padding: 10,
      background: 'rgba(var(--ov-color),0.04)',
      display: 'grid',
      gap: 7,
      maxWidth: 520,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <span style={{
          width: 30, height: 30, borderRadius: 7, flex: 'none',
          display: 'grid', placeItems: 'center',
          background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent)',
        }}>
          <Icon name="fileText" size={15} stroke={1.8} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {manifest.title || output?.label || 'Generated artifact'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-hint)', textTransform: 'uppercase' }}>
            {manifest.kind || output?.mimeType || 'artifact'}{output?.sizeBytes ? ` · ${Math.round(output.sizeBytes / 1024)} KB` : ''}
          </div>
        </div>
      </div>
      {output?.path && (
        <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-hint)', wordBreak: 'break-all' }}>
          {output.path}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {checks.map((check) => (
          <span key={check} style={{
            fontSize: 10.5,
            color: 'var(--success)',
            border: '1px solid rgba(79, 209, 128, .28)',
            borderRadius: 999,
            padding: '2px 7px',
          }}>
            {check}
          </span>
        ))}
      </div>
      {manifest.verification?.errors?.length ? (
        <div style={{ fontSize: 11, color: 'var(--danger)' }}>{manifest.verification.errors.join(', ')}</div>
      ) : null}
    </div>
  );
}

function codeRunFromStep(step: AgentStep): CodeRunDetails | null {
  const run = (step.details as { codeRun?: CodeRunDetails } | undefined)?.codeRun;
  return run && run.language === 'python' ? run : null;
}

function codeCallFromStep(step: AgentStep): CodeRunDetails | null {
  if (step.tool !== 'code.execute' || !step.input) return null;
  try {
    const parsed = JSON.parse(step.input) as { code?: string; label?: string; allow_network?: boolean; timeout_secs?: number };
    if (typeof parsed.code !== 'string') return null;
    return {
      stage: 'ran',
      language: 'python',
      code: parsed.code,
      label: parsed.label,
      allowNetwork: Boolean(parsed.allow_network),
    };
  } catch {
    return null;
  }
}

function codeFileLabel(file: CodeRunFile): string {
  const kb = file.size > 0 ? `, ${file.size < 1024 ? `${file.size} B` : `${Math.round(file.size / 1024)} KB`}` : '';
  return `${file.name} (${file.kind}${kb})`;
}

function CodeExecutionCard({ run, running = false }: { run: CodeRunDetails; running?: boolean }) {
  const [outputOpen, setOutputOpen] = useState(false);
  const statusColor = running ? 'var(--accent)' : run.success ? 'var(--success)' : 'var(--danger)';
  const statusIcon = running ? 'hourglass' : run.success ? 'check' : 'alert';
  const statusLabel = running
    ? 'Futas...'
    : run.success
      ? `Sikeres futas${run.durationMs ? `, ${(run.durationMs / 1000).toFixed(1)}s` : ''}`
      : run.timedOut
        ? 'Idokorlat miatt leallitva'
        : 'Hibaval leallt';
  const files = run.files ?? [];
  const images = run.images ?? [];

  return (
    <div style={{
      margin: '6px 0 8px 24px',
      border: '1px solid var(--border-md)',
      borderRadius: 10,
      background: 'linear-gradient(180deg, rgba(var(--ov-color),0.075), rgba(var(--ov-color),0.035))',
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
        <span style={{
          width: 28, height: 28, borderRadius: 7,
          display: 'grid', placeItems: 'center',
          background: `${statusColor}22`,
          color: statusColor,
        }}>
          <Icon name={statusIcon} size={14} stroke={1.9} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--text-primary)' }}>
            {run.label || 'Kodfuttatas'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-hint)' }}>
            Python sandbox · {statusLabel}{run.allowNetwork ? ' · network engedelyezve' : ''}
          </div>
        </div>
        {running && <span className="dot dot-blue dot-pulse" />}
      </div>

      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        {run.error && (
          <div style={{ color: 'var(--danger)', fontSize: 12, lineHeight: 1.5 }}>
            {run.error}
          </div>
        )}

        {images.length > 0 && (
          <div style={{ display: 'grid', gap: 8 }}>
            {images.map((img) => (
              <figure key={img.path} style={{ margin: 0 }}>
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  style={{
                    maxWidth: '100%',
                    maxHeight: 360,
                    borderRadius: 8,
                    border: '1px solid var(--border-md)',
                    background: '#fff',
                    objectFit: 'contain',
                  }}
                />
                <figcaption style={{ marginTop: 5, fontSize: 11, color: 'var(--text-hint)' }}>{img.name}</figcaption>
              </figure>
            ))}
          </div>
        )}

        {files.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {files.map((file) => (
              <span key={file.path} title={file.path} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                minHeight: 26, maxWidth: '100%',
                border: '1px solid var(--border-md)',
                borderRadius: 999,
                padding: '3px 8px',
                fontSize: 11.5,
                color: 'var(--text-muted)',
                background: 'rgba(0,0,0,.18)',
              }}>
                <Icon name={file.kind === 'image' ? 'image' : file.kind === 'csv' || file.kind === 'json' ? 'fileSpreadsheet' : 'fileText'} size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{codeFileLabel(file)}</span>
              </span>
            ))}
          </div>
        )}

        <details>
          <summary style={{ cursor: 'pointer', fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700 }}>
            Futtatott kod
          </summary>
          <pre style={{
            margin: '8px 0 0',
            maxHeight: 260,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'rgba(0,0,0,.3)',
            borderRadius: 7,
            padding: 10,
          }}>
            {run.code}
          </pre>
        </details>

        {(run.stdout || run.stderr) && (
          <div>
            <button
              onClick={() => setOutputOpen((v) => !v)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'none', border: 'none', padding: 0,
                color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: 11.5, fontWeight: 700,
              }}
            >
              <Icon name="chevronDown" size={10} stroke={1.7} style={{ transform: outputOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }} />
              Kimenet
            </button>
            {outputOpen && (
              <pre style={{
                margin: '8px 0 0',
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: run.stderr ? 'var(--danger)' : 'var(--text-hint)',
                background: 'rgba(0,0,0,.3)',
                borderRadius: 7,
                padding: 10,
              }}>
                {run.stdout ? `STDOUT:\n${run.stdout}` : ''}{run.stdout && run.stderr ? '\n\n' : ''}{run.stderr ? `STDERR:\n${run.stderr}` : ''}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentVisualizationCards({ visualizations }: { visualizations: ChatVisualization[] }) {
  if (visualizations.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      {visualizations.map((visualization) => (
        <VisualizationBlock
          key={visualization.id}
          html={visualization.html}
          title={visualization.title}
          height={visualization.height}
        />
      ))}
    </div>
  );
}

// Category color for a tool's icon tile — mirrors the design's colored action
// tiles (blue folder, red document, accent output, green check, etc.).
function toolTile(icon: string): { fg: string; bg: string; border: string } {
  switch (icon) {
    case 'folder':       return { fg: '#9BA8FF', bg: 'rgba(155,168,255,0.12)', border: 'rgba(155,168,255,0.22)' };
    case 'fileText':     return { fg: '#FF7A7A', bg: 'rgba(255,107,107,0.12)', border: 'rgba(255,107,107,0.22)' };
    case 'upload':       return { fg: 'var(--accent)', bg: 'rgba(var(--accent-rgb),0.13)', border: 'rgba(var(--accent-rgb),0.25)' };
    case 'check':        return { fg: 'var(--success)', bg: 'rgba(62,207,142,0.12)', border: 'rgba(62,207,142,0.22)' };
    case 'search':       return { fg: '#C9A2FF', bg: 'rgba(201,162,255,0.12)', border: 'rgba(201,162,255,0.22)' };
    case 'externalLink': return { fg: '#6EA8FE', bg: 'rgba(110,168,254,0.13)', border: 'rgba(110,168,254,0.24)' };
    case 'sparkle':      return { fg: 'var(--accent)', bg: 'rgba(var(--accent-rgb),0.13)', border: 'rgba(var(--accent-rgb),0.25)' };
    case 'lock':         return { fg: '#F5B544', bg: 'rgba(245,181,68,0.12)', border: 'rgba(245,181,68,0.22)' };
    default:             return { fg: 'var(--text-muted)', bg: 'rgba(var(--ov-color),0.06)', border: 'rgba(var(--ov-color),0.10)' };
  }
}

function AgentStepItem({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false);

  if (['thinking', 'plan', 'checklist', 'verification', 'handoff', 'blocked'].includes(step.type)) {
    const tone = step.type === 'verification'
      ? 'var(--success)'
      : step.type === 'blocked' || step.type === 'handoff'
        ? 'var(--danger)'
        : 'var(--accent)';
    return (
      <div className="agent-step-item" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0 3px 0' }}>
        <span style={{
          width: 18, height: 18, borderRadius: 4, flex: 'none',
          display: 'grid', placeItems: 'center',
          background: 'rgba(var(--accent-rgb),0.12)',
          color: tone,
        }}>
          <Icon name={step.type === 'verification' ? 'check' : step.type === 'checklist' ? 'fileText' : 'sparkle'} size={9} stroke={1.8} />
        </span>
        <span style={{ fontSize: 11.5, color: 'var(--text-hint)', lineHeight: 1.5 }}>
          {step.output || 'Thinking...'}
        </span>
      </div>
    );
  }

  if (step.type === 'tool_call') {
    const codeRun = codeCallFromStep(step);
    if (codeRun) return <CodeExecutionCard run={codeRun} running />;

    const toolName = step.tool || '';
    const iconName = TOOL_ICONS[toolName] || 'circle';
    const tile = toolTile(iconName);
    let argPreview = '';
    try {
      const p = JSON.parse(step.input || '{}');
      argPreview = p.cmd || p.path || p.name || p.question || p.url || p.domain || p.target || p.connection || '';
    } catch { /* ignore */ }

    return (
      <div className="agent-step-item">
        <button
          onClick={() => step.input && setOpen(v => !v)}
          className="tool-card"
          style={{ cursor: step.input ? 'pointer' : 'default', textAlign: 'left' }}
        >
          <span className="tool-card-icon" style={{ background: tile.bg, borderColor: tile.border, color: tile.fg }}>
            <Icon name={iconName} size={14} stroke={1.8} />
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="tool-card-title" style={{ display: 'block' }}>{TOOL_LABELS[toolName] || toolName}</span>
            {argPreview && <span className="tool-card-sub" style={{ display: 'block' }}>{argPreview.slice(0, 80)}</span>}
          </span>
          {step.input && (
            <Icon
              name="chevronDown" size={11} stroke={1.6}
              style={{
                transform: open ? 'none' : 'rotate(-90deg)',
                transition: 'transform .15s',
                color: 'var(--text-hint)', flex: 'none',
              }}
            />
          )}
        </button>
        {open && step.input && (
          <pre style={{
            margin: '0 0 7px 39px', fontSize: 10.5,
            color: 'var(--text-hint)', fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 110, overflow: 'auto',
            background: 'rgba(0,0,0,.3)', borderRadius: 7,
            padding: '6px 9px',
          }}>
            {step.input}
          </pre>
        )}
      </div>
    );
  }

  if (step.type === 'tool_result') {
    const codeRun = codeRunFromStep(step);
    if (codeRun) return <CodeExecutionCard run={codeRun} />;

    const hasErr = Boolean(step.error);
    const rawText = step.error || step.output || '';
    const artifactManifest = !hasErr && step.tool?.startsWith('artifact.render_') ? parseArtifactManifest(rawText) : null;
    const preview = rawText.slice(0, 90);
    const hasMore = rawText.length > 90;

    return (
      <div className="agent-step-item">
        {artifactManifest && <ArtifactResultCard manifest={artifactManifest} />}
        <button
          onClick={() => hasMore && setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 5,
            width: '100%', background: 'none', border: 'none',
            padding: '2px 0 4px 24px',
            cursor: hasMore ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: hasErr ? 'var(--danger)' : 'var(--success)',
            flex: 'none', lineHeight: '17px',
          }}>
            {hasErr ? '✕' : '✓'}
          </span>
          <span style={{
            fontSize: 11, lineHeight: 1.5, flex: 1,
            color: hasErr ? 'var(--danger)' : 'var(--text-hint)',
            overflow: 'hidden', textOverflow: open ? 'clip' : 'ellipsis',
            whiteSpace: open ? 'normal' : 'nowrap',
          }}>
            {preview}{hasMore && !open ? '…' : ''}
          </span>
          {hasMore && (
            <Icon
              name="chevronDown" size={8} stroke={1.5}
              style={{
                transform: open ? 'none' : 'rotate(-90deg)',
                transition: 'transform .15s',
                color: 'var(--text-hint)', flex: 'none', marginTop: 4,
              }}
            />
          )}
        </button>
        {open && hasMore && (
          <pre style={{
            margin: '2px 0 5px 29px', fontSize: 10.5,
            color: hasErr ? 'var(--danger)' : 'var(--text-hint)',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 160, overflow: 'auto',
            background: 'rgba(0,0,0,.3)', borderRadius: 5,
            padding: '5px 8px',
          }}>
            {rawText}
          </pre>
        )}
      </div>
    );
  }

  return null;
}

// ─── Agent message content ────────────────────────────────────────────────────

interface AgentMsgContentProps {
  steps: AgentStep[];
  status: AgentStatus;
  askQuestion?: string | null;
  askAnswer: string;
  onAskAnswerChange: (v: string) => void;
  onAskSubmit: () => void;
  onAskQuickAnswer: (answer: string) => void;
  onStop: () => void;
  finalText?: string;
  isError?: boolean;
  artifacts?: ChatArtifactAttachment[];
  onPreviewArtifact?: (artifact: ChatArtifactAttachment) => void;
  onArtifactsChanged?: () => void;
  selectedArtifactId?: string;
  userId?: string;
  emailDraft?: EmailDraft;
  onEmailDraftChange?: (draft: EmailDraft) => void;
  sources?: WebSource[];
  modelMetadata?: AnswerModelMetadata;
  thinking?: VisibleThinking;
}

function AgentMsgContent({
  steps, status,
  askQuestion, askAnswer, onAskAnswerChange, onAskSubmit,
  onAskQuickAnswer, onStop, finalText, isError, artifacts = [], onPreviewArtifact, onArtifactsChanged, selectedArtifactId, userId,
  emailDraft, onEmailDraftChange, sources = [], modelMetadata, thinking,
}: AgentMsgContentProps) {
  // Collapsed by default: the action timeline is evidence, not the headline. The
  // human-readable narration carries the story; details expand on demand.
  const [stepsOpen, setStepsOpen] = useState(false);
  const isRunning = status !== 'complete' && status !== 'error';
  // Narration = Larund explaining what it's doing; rendered as plain text.
  // Everything else (tool calls/results/checks) lives in the collapsible timeline.
  const narrationSteps = steps.filter(s => s.type === 'narration');
  const timelineSteps = steps.filter(s => s.type !== 'narration');
  const visualizations = collectAgentVisualizations(steps);
  const callCount = timelineSteps.filter(s => s.type === 'tool_call').length;
  const isApprovalPrompt = Boolean(askQuestion && /Approval needed|Approve action/i.test(askQuestion));

  const headerLabel = isRunning
    ? ({ idle: 'Starting…', planning: 'Planning…', executing: 'Executing…', waiting_user: 'Waiting for input…' }[status] ?? 'Working…')
    : status === 'error'
      ? 'Failed'
      : `${callCount} ${callCount === 1 ? 'action' : 'actions'}`;

  return (
    <div style={{ width: '100%' }}>
      <ThinkingDisclosure thinking={thinking} running={isRunning} />

      {/* ── Narration: Larund explaining its work, as readable text ── */}
      {narrationSteps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {narrationSteps.map((step, i) => {
            const isLatest = i === narrationSteps.length - 1;
            return (
              <div key={step.id} style={{
                fontSize: 13.5, lineHeight: 1.6,
                color: isLatest && isRunning ? 'var(--text-primary)' : 'var(--text-muted)',
              }}>
                {step.output}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Disclosure header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        marginBottom: stepsOpen && (timelineSteps.length > 0 || isRunning) ? 8 : 2,
      }}>
        <button
          onClick={() => setStepsOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: isError ? 'var(--danger)' : 'var(--text-muted)',
          }}
        >
          <Icon
            name="chevronDown" size={11} stroke={2}
            style={{ transform: stepsOpen ? 'none' : 'rotate(-90deg)', transition: 'transform .2s' }}
          />
          <span style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '.01em',
            color: isError ? 'var(--danger)' : isRunning ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {headerLabel}
          </span>
        </button>

        {/* Pulsing dot — uses existing CSS class from index.css */}
        {isRunning && <span className="dot dot-blue dot-pulse" />}

        <div style={{ flex: 1 }} />

        {/* Stop button — visible while running */}
        {isRunning && (
          <button
            onClick={onStop}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              height: 22, padding: '0 8px',
              border: '1px solid var(--border-md)',
              borderRadius: 6, background: 'none',
              cursor: 'pointer', fontSize: 11,
              color: 'var(--text-hint)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'var(--danger)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(229,72,77,.4)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'var(--text-hint)'; (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-md)'; }}
          >
            <Icon name="stop" size={9} stroke={2.2} />
            Stop
          </button>
        )}
        {isRunning && (
          <span style={{ fontSize: 10.5, color: 'var(--text-hint)', marginLeft: 6 }}>
            or ESC
          </span>
        )}
      </div>

      {/* ── Steps list (collapsed by default) ── */}
      {stepsOpen && (timelineSteps.length > 0 || isRunning) && (
        <div style={{
          borderLeft: '1.5px solid var(--border-md)',
          paddingLeft: 10,
          marginBottom: finalText || visualizations.length > 0 || askQuestion ? 12 : 0,
          display: 'flex', flexDirection: 'column',
        }}>
          {timelineSteps.map(step => <AgentStepItem key={step.id} step={step} />)}

          {/* Empty placeholder while starting */}
          {isRunning && timelineSteps.length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--text-hint)', padding: '3px 0' }}>
              Getting ready…
            </span>
          )}
        </div>
      )}

      {/* ── Ask user input ── */}
      {askQuestion && (
        <div style={{
          marginTop: 4, marginBottom: 10,
          padding: '11px 13px',
          borderRadius: 10,
          border: '1px solid rgba(var(--accent-rgb),.22)',
          background: 'rgba(var(--accent-rgb),.05)',
        }}>
          <div style={{
            fontSize: 13, color: 'var(--text-primary)',
            marginBottom: 10, lineHeight: 1.55,
          }}>
            {askQuestion}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            {isApprovalPrompt ? (
              <>
                <button className="btn btn-primary" onClick={() => onAskQuickAnswer('allow_once')} style={{ fontSize: 12.5, height: 34 }}>Allow once</button>
                <button className="btn btn-ghost" onClick={() => onAskQuickAnswer('allow_always')} style={{ fontSize: 12.5, height: 34 }}>Always</button>
                <button className="btn btn-ghost" onClick={() => onAskQuickAnswer('deny')} style={{ fontSize: 12.5, height: 34, color: 'var(--danger)' }}>Deny</button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  value={askAnswer}
                  onChange={e => onAskAnswerChange(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && askAnswer.trim()) onAskSubmit(); }}
                  placeholder="Your answer..."
                  style={{
                    flex: 1, padding: '7px 11px', borderRadius: 7,
                    border: '1px solid var(--border-md)',
                    background: 'rgba(0,0,0,.35)',
                    color: 'var(--text-primary)',
                    fontSize: 13, fontFamily: 'inherit', outline: 'none',
                  }}
                  onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(var(--accent-rgb),.4)'; }}
                  onBlur={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border-md)'; }}
                />
                <button
                  className="btn btn-primary"
                  onClick={onAskSubmit}
                  disabled={!askAnswer.trim()}
                  style={{ opacity: askAnswer.trim() ? 1 : 0.38, fontSize: 12.5, height: 34 }}
                >
                  Send
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Final result ── */}
      {finalText && (
        <div style={{
          marginTop: steps.length > 0 ? 10 : 0,
          paddingTop: steps.length > 0 ? 10 : 0,
          borderTop: steps.length > 0 ? '1px solid var(--border)' : 'none',
        }}>
          {isError
            ? <span style={{ color: 'var(--danger)', fontSize: 13.5, lineHeight: 1.65 }}>{finalText}</span>
            : <RichMessage content={finalText} userId={userId} sources={sources} modelMetadata={modelMetadata} />
          }
        </div>
      )}

      <AgentVisualizationCards visualizations={visualizations} />

      {artifacts.length > 0 && (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {artifacts.map((artifact) => (
            <ArtifactCard
              key={artifact.id}
              artifact={artifact}
              selected={artifact.id === selectedArtifactId}
              onPreview={onPreviewArtifact}
              onChanged={onArtifactsChanged}
            />
          ))}
        </div>
      )}

      {(() => {
        const aggregates = steps
          .filter((s) => s.type === 'tool_result' && s.tool === 'sheet.query')
          .map((s) => parseAggregateResult(s.output))
          .filter((r): r is NonNullable<ReturnType<typeof parseAggregateResult>> => r != null);
        if (aggregates.length === 0) return null;
        return (
          <div style={{ display: 'grid', gap: 10 }}>
            {aggregates.map((result, i) => <AggregateResultCard key={i} result={result} />)}
          </div>
        );
      })()}

      {emailDraft && (
        <div style={{ marginTop: 12 }}>
          <EmailComposerCard draft={emailDraft} userId={userId} onChange={(d) => onEmailDraftChange?.(d)} />
        </div>
      )}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  message_type?: string;
  agent_status?: string | null;
  agent_steps_json?: string | null;
  agent_ask_question?: string | null;
  references_json?: string | null;
  artifacts_json?: string | null;
  search_citations_json?: string | null;
  search_mode?: SearchMode | null;
  web_search_runs_json?: string | null;
  web_sources_json?: string | null;
  web_citations_json?: string | null;
  model_metadata_json?: string | null;
  search_evidence_json?: string | null;
  thinking_json?: string | null;
  _loading?: boolean;
  _usage?: string;
  _error?: boolean;
  streaming?: boolean;
  // Agent execution fields — UI-only, not persisted to DB
  _agent?: boolean;
  _agentStatus?: AgentStatus;
  _agentSteps?: AgentStep[];
  _agentAskQuestion?: string | null;
  _references?: ReferencedContext[];
  _artifacts?: ChatArtifactAttachment[];
  _emailDraft?: EmailDraft;
  _searchCitations?: SearchCitation[];
  _searchMode?: SearchMode;
  _webSearchRuns?: WebSearchRun[];
  _webSources?: WebSource[];
  _webCitations?: WebCitation[];
  _modelMetadata?: AnswerModelMetadata;
  _searchEvidence?: SearchEvidence;
  _thinking?: VisibleThinking;
  // Subtle routing label shown after send ("Answering" / "Needs confirmation").
  _intentLabel?: string;
};

type RunningTask = {
  kind: 'chat' | 'agent';
  assistantMessageId: string;
  sessionId: string;
};

// No-mouse core no longer produces screenshots; persist steps as-is.
function stripScreenshotFromStep(step: AgentStep): AgentStep {
  return step;
}

function parseAgentSteps(raw?: string | null): AgentStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step): step is AgentStep => (
      step && typeof step === 'object' && typeof step.id === 'string' &&
      typeof step.type === 'string' && typeof step.timestamp === 'string'
    ));
  } catch {
    return [];
  }
}

function parseChatArtifacts(raw?: string | null): ChatArtifactAttachment[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((artifact): artifact is ChatArtifactAttachment => (
      artifact && typeof artifact === 'object' &&
      typeof artifact.id === 'string' &&
      typeof artifact.artifactId === 'string' &&
      typeof artifact.kind === 'string'
    ));
  } catch {
    return [];
  }
}

function thinkingFromAgentSteps(steps: AgentStep[]): VisibleThinking | undefined {
  const parts = steps
    .filter((step) => ['thinking', 'plan', 'checklist', 'verification'].includes(step.type))
    .map((step) => step.output?.trim())
    .filter((value): value is string => Boolean(value));
  if (parts.length === 0) return undefined;
  return { content: parts.join('\n\n') };
}

/** The latest step carrying an email draft (email.compose OR a Gmail connection
 * call), used to (re)hydrate the composer card. */
function emailDraftFromStep(step: AgentStep): EmailDraft | undefined {
  return (step.details as { emailDraft?: EmailDraft } | undefined)?.emailDraft;
}
function emailDraftFromSteps(steps: AgentStep[]): EmailDraft | undefined {
  for (let i = steps.length - 1; i >= 0; i--) {
    const draft = emailDraftFromStep(steps[i]);
    if (draft) return draft;
  }
  return undefined;
}

function codeArtifactsFromStep(step: AgentStep): ChatArtifactAttachment[] {
  const run = codeRunFromStep(step);
  if (!run?.files?.length) return [];
  return run.files
    .map((file) => file.artifactManifest ? manifestToChatArtifact(file.artifactManifest) : null)
    .filter((artifact): artifact is ChatArtifactAttachment => artifact != null);
}

function hydrateMessage(row: any): Message {
  const isAgent = row.message_type === 'agent'
    || Boolean(row.agent_status || row.agent_steps_json || row.agent_ask_question);
  const agentSteps = parseAgentSteps(row.agent_steps_json);
  const searchCitations = parseSearchCitations(row.search_citations_json);
  const webSources = parseJsonArray(row.web_sources_json, isWebSource);
  const references = deserializeReferences(row.references_json || undefined)
    .map((ref) => 'refId' in ref ? ref : documentReferenceToMention(ref));

  return {
    ...row,
    _agent: isAgent,
    _agentStatus: row.agent_status ?? undefined,
    _agentSteps: agentSteps,
    _emailDraft: emailDraftFromSteps(agentSteps),
    _agentAskQuestion: row.agent_ask_question ?? null,
    _error: Boolean(row._error) || (isAgent && row.agent_status === 'error'),
    _references: references,
    _artifacts: parseChatArtifacts(row.artifacts_json),
    _searchCitations: searchCitations,
    _searchMode: (row.search_mode as SearchMode | null) ?? 'none',
    _webSearchRuns: parseJsonArray(row.web_search_runs_json, isWebSearchRun),
    _webSources: webSources.length ? webSources : sourcesFromSearchCitations(searchCitations),
    _webCitations: parseJsonArray(row.web_citations_json, isWebCitation),
    _modelMetadata: parseJsonObject(row.model_metadata_json, isAnswerModelMetadata),
    _searchEvidence: parseJsonObject(row.search_evidence_json, isSearchEvidence),
    _thinking: parseThinking(row.thinking_json),
  };
}

function modelTierFor(tag?: string): AnswerModelMetadata['tier'] {
  const value = (tag ?? '').toLowerCase();
  if (value.includes('fast')) return 'fast';
  if (value.includes('balanced')) return 'balanced';
  if (value.includes('power')) return 'power';
  return 'unknown';
}

function isSearchEvidence(item: unknown): item is SearchEvidence {
  return Boolean(item && typeof item === 'object' && typeof (item as SearchEvidence).mode === 'string');
}

function buildChatSearchEvidence(input: {
  route: WebSearchRouteDecision;
  modelId: string;
  query: string;
  sources: WebSource[];
  citations: WebCitation[];
}): SearchEvidence {
  return evaluateSearchEvidence({
    mode: input.route.strategy === 'provider_native_search' ? 'provider_native'
      : input.route.strategy === 'server_side_search_adapter' ? 'server_side'
        : 'browser_fallback',
    provider: String(input.route.provider),
    modelId: input.modelId,
    queries: [input.query],
    sources: input.sources.map((source) => ({
      title: source.title,
      url: source.url,
      domain: source.domain,
      snippet: source.snippet,
      cited: input.citations.some((citation) => citation.sourceId === source.id) || source.kind === 'citation',
    })),
    citations: input.citations.map((citation) => {
      const source = input.sources.find((item) => item.id === citation.sourceId);
      return {
        sourceUrl: source?.url ?? citation.sourceId,
        title: source?.title ?? citation.sourceId,
        startIndex: citation.startIndex,
        endIndex: citation.endIndex,
      };
    }),
    usedBrowserOpen: false,
    usedSearchEnginePage: false,
    quality: 'failed',
    warnings: input.route.strategy === 'provider_native_search' ? [] : [input.route.reason],
  });
}

// ─── Main ChatScreen ──────────────────────────────────────────────────────────

export function ChatScreen({
  model, setModel, userEmail, userId, projectId, credits, onCreditsRefresh, openSessionId, onSessionOpened,
}: {
  model: string;
  setModel: (m: string) => void;
  userEmail?: string | null;
  userId?: string | null;
  projectId?: string | null;
  credits?: UserCredits | null;
  onCreditsRefresh?: () => void;
  /** Externally-requested session to open (e.g. from an automation's "Open chat"). */
  openSessionId?: string | null;
  onSessionOpened?: () => void;
}) {
  const [activeChat,        setActiveChat       ] = useState<string | null>(null);
  const [messages,          setMessages         ] = useState<Message[]>([]);
  const [messagesLoading,   setMessagesLoading  ] = useState(false);
  const [messagesError,     setMessagesError    ] = useState<string | null>(null);
  const [loadedSessionId,   setLoadedSessionId  ] = useState<string | null>(null);
  const [input,             setInput            ] = useState('');
  const [sending,           setSending          ] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [copiedId,          setCopiedId         ] = useState<string | null>(null);
  const [routing,           setRouting          ] = useState(false);
  const [agentAskAnswer,    setAgentAskAnswer   ] = useState('');
  const [runningTask,       setRunningTask      ] = useState<RunningTask | null>(null);
  const [references,        setReferences       ] = useState<ReferencedContext[]>([]);
  const [composerAttachments, setComposerAttachments] = useState<DocumentReference[]>([]);
  const [composerDropActive, setComposerDropActive] = useState(false);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [previewState,      setPreviewState     ] = useState<ArtifactPreviewState>({ isOpen: false, mode: 'preview' });
  const [webSearchPreference, setWebSearchPreference] = useState<WebSearchPreference>('auto');
  const [deepResearch, setDeepResearch] = useState(false);

  const editorRef     = useRef<RichMentionEditorHandle>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const scrollRef     = useRef<HTMLDivElement>(null);
  const referencePickerTriggerRef = useRef<HTMLButtonElement>(null);
  const skipNextFetch = useRef(false);
  const loadRequestSeq = useRef(0);
  const activeChatRef = useRef<string | null>(null);
  const abortRef      = useRef<AgentAbortSignal>({ aborted: false });
  const chatAbortRef  = useRef<AbortController | null>(null);
  const askResolveRef = useRef<((answer: string) => void) | null>(null);

  useEffect(() => {
    activeChatRef.current = activeChat;
    if (!activeChat) {
      loadRequestSeq.current++;
      setMessages([]);
      setMessagesLoading(false);
      setMessagesError(null);
      setLoadedSessionId(null);
      return;
    }
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      setMessagesLoading(false);
      setMessagesError(null);
      setLoadedSessionId(activeChat);
      return;
    }
    void loadMessagesForSession(activeChat);
  }, [activeChat]);

  useEffect(() => {
    const artifactCount = messages.reduce((count, message) => count + (message._artifacts?.length ?? 0), 0);
    if (artifactCount === 0 && previewState.isOpen) {
      setPreviewState({ isOpen: false, mode: 'preview' });
    }
  }, [messages, previewState.isOpen]);

  useEffect(() => {
    loadRequestSeq.current++;
    setActiveChat(null);
    setMessages([]);
    setMessagesLoading(false);
    setMessagesError(null);
    setLoadedSessionId(null);
    setSidebarRefreshKey(k => k + 1);
  }, [projectId]);

  // Honor an external "open this session" request (e.g. an automation's Open chat).
  // Declared after the project-reset effect so it wins on mount. Clears the parent
  // request once consumed so re-opening the same session works.
  useEffect(() => {
    if (!openSessionId) return;
    setActiveChat(openSessionId);
    setSidebarRefreshKey(k => k + 1);
    onSessionOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionId]);

  useEffect(() => {
    // Scroll only the message list to its bottom — never via scrollIntoView,
    // which would also scroll ancestor containers and push the whole layout up.
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const chatTitle = messages.find(m => m.role === 'user')?.content.slice(0, 80) ?? '';
  const allArtifacts = messages.flatMap((m) => m._artifacts ?? []);

  async function readSessionMessages(sessionId: string): Promise<Message[]> {
    const rows = await getMessages(sessionId);
    return rows.map((row) => {
      try {
        return hydrateMessage(row);
      } catch (err) {
        console.warn('Failed to hydrate message metadata:', err, row);
        return {
          id: String(row.id ?? uuidv4()),
          session_id: String(row.session_id ?? sessionId),
          role: String(row.role ?? 'assistant'),
          content: String(row.content ?? ''),
          created_at: String(row.created_at ?? new Date().toISOString()),
          _error: row.role === 'assistant' && !row.content,
        };
      }
    });
  }

  async function loadMessagesForSession(sessionId: string): Promise<Message[]> {
    const requestId = ++loadRequestSeq.current;
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const nextMessages = await readSessionMessages(sessionId);
      if (requestId === loadRequestSeq.current && activeChatRef.current === sessionId) {
        setMessages(nextMessages);
        setLoadedSessionId(sessionId);
        setMessagesLoading(false);
      }
      return nextMessages;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (requestId === loadRequestSeq.current && activeChatRef.current === sessionId) {
        setMessages([]);
        setLoadedSessionId(null);
        setMessagesError(msg || 'Could not load this chat.');
        setMessagesLoading(false);
      }
      throw err;
    }
  }

  // The rich composer (contentEditable) is the source of truth: it reports its
  // derived plain text + ordered references here on every edit.
  function handleEditorChange(text: string, refs: ReferencedContext[]) {
    setInput(text);
    setReferences(refs);
  }

  function handleReferencesPicked(picked: DocumentReference[]) {
    addComposerAttachments(picked);
    setReferencePickerOpen(false);
    editorRef.current?.focus();
  }

  function addComposerAttachments(picked: DocumentReference[]) {
    if (picked.length === 0) return;
    setComposerAttachments((prev) => mergeDocumentReferences(prev, picked));
  }

  function removeComposerAttachment(id: string) {
    setComposerAttachments((prev) => prev.filter((ref) => ref.id !== id));
  }

  async function handleReferenceDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setComposerDropActive(false);
    try {
      const refs = await referencesFromDroppedDataTransfer(e.dataTransfer, { scopeId: activeChat ?? 'draft' });
      addComposerAttachments(refs);
      if (refs.length > 0) editorRef.current?.focus();
    } catch (err) {
      console.warn('Failed to attach dropped file(s):', err);
    }
  }

  async function handleComposerPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const hasClipboardFiles = Array.from(e.clipboardData?.items || []).some((item) => item.kind === 'file')
      || (e.clipboardData?.files?.length ?? 0) > 0;
    if (!hasClipboardFiles) return;
    e.preventDefault();
    try {
      const refs = await referencesFromClipboardEvent(e.clipboardData, { scopeId: activeChat ?? 'draft' });
      addComposerAttachments(refs);
      if (refs.length > 0) editorRef.current?.focus();
    } catch (err) {
      console.warn('Failed to attach pasted file(s):', err);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleStarter(prompt: string) {
    setInput(prompt);
    setTimeout(() => editorRef.current?.setText(prompt), 50);
  }

  function handleCopyMessage(id: string, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  function previewArtifact(artifact: ChatArtifactAttachment) {
    setPreviewState((state) => ({
      ...state,
      isOpen: true,
      selectedArtifactId: artifact.id,
      mode: 'preview',
    }));
  }

  // Persist an edited/sent email draft: update the message and rewrite the latest
  // email.compose step's details so the card survives a reload.
  function handleEmailDraftChange(msgId: string, draft: EmailDraft) {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const steps = m._agentSteps ?? [];
      let patched = false;
      const nextSteps = [...steps];
      for (let i = nextSteps.length - 1; i >= 0; i--) {
        if (emailDraftFromStep(nextSteps[i])) {
          nextSteps[i] = { ...nextSteps[i], details: { ...(nextSteps[i].details ?? {}), emailDraft: draft } };
          patched = true;
          break;
        }
      }
      void updateMessage(msgId, { agent_steps_json: JSON.stringify(nextSteps.map(stripScreenshotFromStep)) })
        .catch(err => console.warn('Failed to persist email draft:', err));
      return { ...m, _emailDraft: draft, _agentSteps: patched ? nextSteps : steps };
    }));
  }

  function refreshCurrentMessages() {
    if (!activeChat) return;
    loadMessagesForSession(activeChat).catch((err) =>
      console.warn('Failed to refresh messages:', err),
    );
  }

  function handleStop() {
    if (!runningTask) return;

    setSending(false);
    setRunningTask(null);

    if (runningTask.kind === 'chat') {
      chatAbortRef.current?.abort();
      setMessages(prev => prev.map(m =>
        m.id === runningTask.assistantMessageId
          ? { ...m, content: m.content || 'Stopped.', streaming: false }
          : m,
      ));
      return;
    }

    abortRef.current.aborted = true;
    if (askResolveRef.current) {
      askResolveRef.current('Stopped by user.');
      askResolveRef.current = null;
      setAgentAskAnswer('');
    }

    setMessages(prev => prev.map(m =>
      m.id === runningTask.assistantMessageId
        ? { ...m, content: 'Stopped.', _agentStatus: 'complete', _agentAskQuestion: null }
        : m,
    ));
    updateMessage(runningTask.assistantMessageId, {
      content: 'Stopped.',
      message_type: 'agent',
      agent_status: 'complete',
      agent_ask_question: null,
    }).catch(err => console.warn('Failed to persist stopped agent message:', err));
  }

  function handleAgentStop() {
    handleStop();
  }

  function handleAskSubmit() {
    if (!agentAskAnswer.trim() || !askResolveRef.current) return;
    askResolveRef.current(agentAskAnswer.trim());
    askResolveRef.current = null;
    setAgentAskAnswer('');
  }

  function handleAskQuickAnswer(answer: string) {
    if (!askResolveRef.current) return;
    askResolveRef.current(answer);
    askResolveRef.current = null;
    setAgentAskAnswer('');
  }

  async function handleAgentRun(
    task: string,
    sessionId: string,
    openrouterId: string,
    asstMsgId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    taskReferences: ReferencedContext[],
    firstExchange: boolean,
  ) {
    type AgentPersistState = {
      content: string;
      status: AgentStatus;
      askQuestion: string | null;
      steps: AgentStep[];
      artifacts: ChatArtifactAttachment[];
      webSearchRuns: WebSearchRun[];
      webSources: WebSource[];
      webCitations: WebCitation[];
      modelMetadata?: AnswerModelMetadata;
      searchEvidence?: SearchEvidence;
    };

    let agentState: AgentPersistState = {
      content: '',
      status: 'planning',
      askQuestion: null,
      steps: [],
      artifacts: [],
      webSearchRuns: [],
      webSources: [],
      webCitations: [],
    };

    // Helper: patch any field on the agent message
    const patchMsg = (patch: Partial<Message>) =>
      setMessages(prev => prev.map(m => m.id === asstMsgId ? { ...m, ...patch } : m));

    let persistQueue = Promise.resolve();
    const persistAgentState = (nextState: AgentPersistState) => {
      const snapshot: AgentPersistState = {
        content: nextState.content,
        status: nextState.status,
        askQuestion: nextState.askQuestion,
        steps: [...nextState.steps],
        artifacts: [...nextState.artifacts],
        webSearchRuns: [...nextState.webSearchRuns],
        webSources: [...nextState.webSources],
        webCitations: [...nextState.webCitations],
        modelMetadata: nextState.modelMetadata,
        searchEvidence: nextState.searchEvidence,
      };
      const payload = {
        content: snapshot.content,
        message_type: 'agent',
        agent_status: snapshot.status,
        agent_ask_question: snapshot.askQuestion,
        agent_steps_json: JSON.stringify(snapshot.steps.map(stripScreenshotFromStep)),
        artifacts_json: JSON.stringify(snapshot.artifacts),
        web_search_runs_json: JSON.stringify(snapshot.webSearchRuns),
        web_sources_json: JSON.stringify(snapshot.webSources),
        web_citations_json: JSON.stringify(snapshot.webCitations),
        model_metadata_json: snapshot.modelMetadata ? JSON.stringify(snapshot.modelMetadata) : null,
        search_evidence_json: snapshot.searchEvidence ? JSON.stringify(snapshot.searchEvidence) : null,
      };

      persistQueue = persistQueue
        .then(async () => {
          await updateMessage(asstMsgId, payload);
          await touchSession(sessionId);
        })
        .catch(err => {
          console.warn('Failed to persist agent message state:', err);
        });
    };

    const syncAgentState = (patch: Partial<AgentPersistState>, uiPatch: Partial<Message>) => {
      agentState = { ...agentState, ...patch };
      patchMsg(uiPatch);
      persistAgentState(agentState);
    };

    const appendStep = (step: AgentStep) => {
      // Upsert by id: streaming "thinking" steps re-emit the same id token-by-token
      // and must replace the existing entry rather than pile up duplicates.
      const exists = agentState.steps.some(s => s.id === step.id);
      const nextSteps = exists
        ? agentState.steps.map(s => (s.id === step.id ? step : s))
        : [...agentState.steps, step];
      agentState = { ...agentState, steps: nextSteps };
      patchMsg({ _agentSteps: nextSteps });
      persistAgentState(agentState);

      // Surface/refresh the email composer card from ANY step that carries a
      // draft — email.compose, or a direct connection.call to Gmail create_draft/send.
      if (step.type === 'tool_result' || step.type === 'verification') {
        const draft = emailDraftFromStep(step);
        if (draft) patchMsg({ _emailDraft: draft });
      }

      if (step.type === 'tool_result' && step.tool?.startsWith('artifact.render_') && step.output) {
        const manifest = parseManifestOutput(step.output);
        if (manifest) {
          const artifact = manifestToChatArtifact(manifest);
          const nextArtifacts = dedupeArtifacts([...agentState.artifacts, artifact]);
          agentState = { ...agentState, artifacts: nextArtifacts };
          patchMsg({ _artifacts: nextArtifacts, artifacts_json: JSON.stringify(nextArtifacts) });
          setPreviewState((state) => ({
            ...state,
            isOpen: true,
            selectedArtifactId: artifact.id,
            mode: 'preview',
          }));
          persistAgentState(agentState);
        }
      }

      if (step.type === 'tool_result' && step.tool === 'code.execute') {
        const generatedArtifacts = codeArtifactsFromStep(step);
        if (generatedArtifacts.length) {
          const nextArtifacts = dedupeArtifacts([...agentState.artifacts, ...generatedArtifacts]);
          agentState = { ...agentState, artifacts: nextArtifacts };
          patchMsg({ _artifacts: nextArtifacts, artifacts_json: JSON.stringify(nextArtifacts) });
          setPreviewState((state) => ({
            ...state,
            isOpen: state.isOpen || generatedArtifacts.some((artifact) => artifact.kind === 'image'),
            selectedArtifactId: generatedArtifacts.find((artifact) => artifact.kind === 'image')?.id ?? state.selectedArtifactId,
            mode: 'preview',
          }));
          persistAgentState(agentState);
        }
      }
    };

    abortRef.current = { aborted: false };
    persistAgentState(agentState);

    const settings = await getSettings().catch(() => null);
    const autonomyMode = ((settings?.autonomy_mode as PolicyAutonomyMode | undefined) ?? 'semi');
    const agentStartedAt = Date.now();

    await runAgentLoop(
      task,
      openrouterId,
      userId!,
      {
        onStatus:  (status) => syncAgentState({ status }, { _agentStatus: status }),
        onStep:    (step)   => appendStep(step),

        onAskUser: (question) => new Promise<string>(resolve => {
          syncAgentState({ askQuestion: question }, { _agentAskQuestion: question });
          askResolveRef.current = (answer: string) => {
            syncAgentState({ askQuestion: null }, { _agentAskQuestion: null });
            resolve(answer);
          };
        }),

        onApproval: (req) => new Promise<'allow_once' | 'allow_always' | 'deny'>(resolve => {
          appendStep({
            id: `approval-${Date.now()}`,
            type: 'approval',
            tool: req.action,
            risk: req.risk,
            output: req.reason,
            timestamp: new Date().toISOString(),
          });
          const question = `Approve action: ${req.action} (${req.risk})\n${req.reason}\nArgs: ${req.argsSummary}`;
          syncAgentState({ askQuestion: question, status: 'waiting_user' }, { _agentAskQuestion: question, _agentStatus: 'waiting_user' });
          askResolveRef.current = (answer: string) => {
            syncAgentState({ askQuestion: null, status: 'executing' }, { _agentAskQuestion: null, _agentStatus: 'executing' });
            const normalized = answer === 'allow_always' || answer === 'deny' ? answer : 'allow_once';
            resolve(normalized);
          };
        }),

        onComplete: (summary) => {
          const webMetadata = webMetadataFromAgentSteps(agentState.steps);
          const agentSearchEvidence = evaluateSearchEvidence({
            mode: webMetadata.sources.length ? 'server_side' : 'browser_fallback',
            provider: webMetadata.runs[0]?.provider ?? 'none',
            modelId: openrouterId,
            queries: webMetadata.runs.map((run) => run.query),
            sources: webMetadata.sources.map((source) => ({
              title: source.title,
              url: source.url,
              domain: source.domain,
              snippet: source.snippet,
              cited: true,
            })),
            citations: [],
            usedBrowserOpen: agentState.steps.some((step) => step.type === 'tool_result' && step.tool === 'browser.open'),
            usedSearchEnginePage: false,
            quality: 'failed',
            warnings: [],
          });
          const baseQuality = verifyWebAnswerQuality(summary, webMetadata.sources, {
            webSearchMode: webMetadata.sources.length ? 'fast' : 'none',
          });
          const quality = agentSearchEvidence.quality === 'failed'
            ? {
              ...baseQuality,
              ok: false,
              reasons: [...baseQuality.reasons, ...agentSearchEvidence.warnings],
            }
            : baseQuality;
          const selectedModel = MODELS.find(m => m.openrouter_id === openrouterId);
          const modelMetadata = buildAnswerModelMetadata({
            provider: 'openrouter',
            modelId: openrouterId,
            displayName: selectedModel?.name ?? openrouterId,
            tier: modelTierFor(selectedModel?.tag),
          latencyMs: Date.now() - agentStartedAt,
          toolsUsed: webMetadata.toolsUsed,
          webSearchMode: webMetadata.sources.length ? 'fast' : 'none',
          searchStrategy: webMetadata.sources.length ? 'server_side_search_adapter' : undefined,
          searchProvider: webMetadata.runs[0]?.provider,
          webSearchRunsCount: webMetadata.runs.length,
          webSourcesCount: webMetadata.sources.length,
          quality,
          });
          syncAgentState(
            {
              content: summary,
              status: 'complete',
              askQuestion: null,
              webSearchRuns: webMetadata.runs,
              webSources: webMetadata.sources,
              webCitations: [],
              modelMetadata,
              searchEvidence: agentSearchEvidence,
            },
            {
              content: summary,
              _agentStatus: 'complete',
              _agentAskQuestion: null,
              _webSearchRuns: webMetadata.runs,
              _webSources: webMetadata.sources,
              _webCitations: [],
              _modelMetadata: modelMetadata,
              _searchEvidence: agentSearchEvidence,
            },
          );
          setSending(false);
          setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
          onCreditsRefresh?.();
          if (firstExchange) void maybeGenerateTitle(sessionId, task, summary);
          void runMemoryExtraction({
            userId: userId!,
            workspaceId: projectId ?? undefined,
            userText: task,
            summary,
            verified: true,
          });
        },

        onError: (err) => {
          syncAgentState(
            { content: err, status: 'error', askQuestion: null },
            { content: err, _agentStatus: 'error', _error: true, _agentAskQuestion: null },
          );
          setSending(false);
          setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
          onCreditsRefresh?.();
        },
      },
      abortRef.current,
      {
        sessionId,
        history,
        references: taskReferences,
        policy: policyForAutonomyMode(autonomyMode),
        // Active workspace/role/workflow chosen on the Coworker pages. All fall
        // back gracefully inside the loop when unset. A workflow template is
        // one-shot: it is consumed (cleared) once a run starts.
        workspaceId: projectId ?? undefined,
        roleId: localStorage.getItem('active_role_id') ?? undefined,
        workflowTemplateId: consumeActiveWorkflowTemplate(),
      },
    );

    await persistQueue;
  }

  // Semantic chat naming. Runs async after the first exchange so it never blocks
  // the chat; skips silently if the user already renamed the chat (DB enforces
  // the lock). Refreshes the sidebar so the new title appears.
  async function maybeGenerateTitle(sessionId: string, userText: string, assistantText: string) {
    if (!userId) return;
    try {
      const modelDef = MODELS.find(m => m.id === model) ?? MODELS[1];
      const title = await generateChatTitle({ userText, assistantText }, modelDef.openrouter_id, userId);
      const applied = await setAutoSessionTitle(sessionId, title);
      if (applied) setSidebarRefreshKey(k => k + 1);
    } catch (err) {
      console.warn('Title generation failed:', err);
    }
  }

  async function handleSend() {
    const text = input.trim();
    const taskReferences = mergeTaskReferences(references, composerAttachments);
    if ((!text && taskReferences.length === 0) || sending || runningTask || !userId) return;
    // Clean message for display/storage: only what the user wrote. Attached
    // references are shown as chips; the model gets their contents via ingest.
    const messageText = text || 'Use the referenced input(s).';
    const modelDef = MODELS.find(m => m.id === model) ?? MODELS[1];
    const wantsDeepResearch = deepResearch || isDeepResearchRequest(messageText);
    const userExplicitlyRequestedWeb = explicitWebRequested(messageText);
    const wantsFastWeb = webSearchPreference === 'always'
      || (webSearchPreference === 'auto' && shouldUseWebSearch(messageText));
    const searchMode: SearchMode = wantsDeepResearch
      ? 'deep'
      : webSearchPreference === 'never'
        ? 'none'
        : wantsFastWeb ? 'fast' : 'none';
    const webModeForRoute: 'off' | 'auto' | 'required' = searchMode === 'none'
      ? 'off'
      : (webSearchPreference === 'always' || userExplicitlyRequestedWeb || wantsDeepResearch) ? 'required' : 'auto';
    const webRouteDecision = routeWebSearch({
      userPrompt: messageText,
      selectedModel: {
        provider: 'openrouter',
        modelId: modelDef.openrouter_id,
        displayName: modelDef.name,
      },
      webMode: webModeForRoute,
      searchDepth: searchMode === 'deep' ? 'extended' : 'standard',
    });

    if (searchMode === 'deep') {
      const estimatedCredits = 1;
      if (credits && !credits.unlimited && credits.visible_balance < estimatedCredits) {
        alert('Nincs elég kredited a mélykutatáshoz. Válts nagyobb csomagra vagy tölts fel kreditet.');
        return;
      }
      const ok = window.confirm('A mélykutatás Perplexity Sonar Pro Search modellt használ, és többe kerül, mint a normál chat. Becsült minimum: kb. 1 kredit. Folytatod?');
      if (!ok) return;
    }
    // First exchange in this session → generate a semantic title afterwards.
    let currentTaskId: string | null = null;
    let currentSessionId: string | null = null;
    setSending(true);
    setInput('');
    editorRef.current?.clear();
    setReferences([]);
    setComposerAttachments([]);
    try {

    // ── Create / get session ──
    let sessionId = activeChat;
    let priorMessagesForHistory: Message[] = [];
    if (!sessionId) {
      sessionId = uuidv4();
      await createSession(sessionId, (text || taskReferences[0]?.label || 'Referenced task').slice(0, 40), projectId);
      skipNextFetch.current = true;
      setActiveChat(sessionId);
      setLoadedSessionId(sessionId);
      setSidebarRefreshKey(k => k + 1);
    } else {
      priorMessagesForHistory = loadedSessionId === sessionId
        ? messages
        : await readSessionMessages(sessionId);
      if (loadedSessionId !== sessionId) {
        setMessages(priorMessagesForHistory);
        setLoadedSessionId(sessionId);
        setMessagesError(null);
        setMessagesLoading(false);
      }
    }
    currentSessionId = sessionId;
    const isFirstExchange = priorMessagesForHistory
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .length === 0;

    // ── User message ──
    const userMsgId = uuidv4();
    const userMessage: Message = {
      id: userMsgId, session_id: sessionId!,
      role: 'user', content: messageText, created_at: new Date().toISOString(),
      references_json: serializeReferences(taskReferences),
      _references: taskReferences,
    };
    setMessages(prev => loadedSessionId === sessionId ? [...prev, userMessage] : [...priorMessagesForHistory, userMessage]);
    await addMessage(userMsgId, sessionId, 'user', messageText, {
      references_json: serializeReferences(taskReferences),
      created_at: userMessage.created_at,
    });

    // ── Intent routing ──
    // Larund decides automatically whether to answer (chat), act (agent), or ask
    // a clarifying question. There is no manual "Agent mode" toggle anymore.
    setRouting(true);
    let intent;
    try {
      intent = await classifyIntent(
        { text: text || messageText, hasReferences: taskReferences.length > 0 },
        modelDef.openrouter_id,
        userId,
      );
    } catch {
      intent = { mode: 'chat' as const, confidence: 0.3, reason: 'fallback', requiredCapabilities: [] };
    } finally {
      setRouting(false);
    }
    const runAsAgent = intent.mode === 'agent';
    const clarify = intent.mode === 'clarify';

    // ── Agent path ──
    if (runAsAgent) {
      // Prior conversation for the agent loop: user messages and any agent/AI
      // final summaries, oldest first. Gives the operator real context so a
      // correction continues the previous task instead of restarting it.
      const agentHistory = priorMessagesForHistory
        .filter(m => !m._loading && !m.streaming && m.content)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const asstMsgId = uuidv4();
      currentTaskId = asstMsgId;
      setMessages(prev => [...prev, {
        id: asstMsgId, session_id: sessionId!, role: 'assistant',
        content: '', created_at: new Date().toISOString(),
        _agent: true, _agentStatus: 'planning', _agentSteps: [],
      }]);
      setRunningTask({ kind: 'agent', assistantMessageId: asstMsgId, sessionId: sessionId! });
      await addMessage(asstMsgId, sessionId, 'assistant', '', {
        message_type: 'agent',
        agent_status: 'planning',
        agent_steps_json: '[]',
        agent_ask_question: null,
        artifacts_json: '[]',
      }).catch(err => console.warn('Failed to save agent message shell:', err));
      await handleAgentRun(text || messageText, sessionId, modelDef.openrouter_id, asstMsgId, agentHistory, taskReferences, isFirstExchange);
      return;
    }

    // ── Normal chat / clarify path ──
    const asstMsgId = uuidv4();
    const assistantCreatedAt = new Date().toISOString();
    currentTaskId = asstMsgId;
    setMessages(prev => [...prev, {
      id: asstMsgId, session_id: sessionId!, role: 'assistant',
      content: '', created_at: assistantCreatedAt, streaming: true,
      _intentLabel: searchMode === 'deep' ? 'Deep research' : searchMode === 'fast' ? 'Searching web' : clarify ? 'Needs confirmation' : 'Answering',
      _searchMode: searchMode,
      _searchCitations: [],
    }]);
    setRunningTask({ kind: 'chat', assistantMessageId: asstMsgId, sessionId: sessionId! });
    await addMessage(asstMsgId, sessionId!, 'assistant', '', {
      created_at: assistantCreatedAt,
      search_mode: searchMode,
    });

    if (webModeForRoute === 'required' && webRouteDecision.strategy === 'blocked_missing_search_capability') {
      const blocked = 'A webes kereső jelenleg nincs megfelelően bekötve ehhez a modellhez/providerhez. Nem használok Chrome fallbacket sima kereséshez. Engedélyezz egy kereső providert: OpenAI web_search / Gemini google_search / Brave Search / Tavily / Exa / OpenRouter web search.';
      const blockedMetadata = buildAnswerModelMetadata({
        provider: 'openrouter',
        modelId: modelDef.openrouter_id,
        displayName: modelDef.name,
        tier: modelTierFor(modelDef.tag),
        toolsUsed: [],
        webSearchMode: searchMode,
        searchStrategy: webRouteDecision.strategy,
        searchProvider: webRouteDecision.provider,
        searchWarnings: [webRouteDecision.reason],
        webSearchRunsCount: 0,
        webSourcesCount: 0,
        quality: {
          ok: false,
          reasons: [webRouteDecision.reason],
          sourceCount: 0,
          citationCount: 0,
          hasEnoughDetail: false,
          hasDatesOrFreshness: false,
        },
      });
      const blockedEvidence = buildChatSearchEvidence({
        route: webRouteDecision,
        modelId: modelDef.openrouter_id,
        query: messageText,
        sources: [],
        citations: [],
      });
      setMessages(prev => prev.map(m =>
        m.id === asstMsgId ? { ...m, content: blocked, streaming: false, _error: true, _modelMetadata: blockedMetadata, _searchEvidence: blockedEvidence } : m,
      ));
      await addMessage(asstMsgId, sessionId!, 'assistant', blocked, {
        search_mode: searchMode,
        web_search_runs_json: JSON.stringify([]),
        web_sources_json: JSON.stringify([]),
        web_citations_json: JSON.stringify([]),
        model_metadata_json: JSON.stringify(blockedMetadata),
        search_evidence_json: JSON.stringify(blockedEvidence),
      }).catch(err => console.warn('Failed to save blocked assistant message:', err));
      setSending(false);
      setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
      return;
    }

    const history: ChatMessage[] = priorMessagesForHistory
      .filter(m => !m._loading && !m.streaming && !m._agent && m.content)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Give Larund its conversational identity + custom instructions. Without this
    // the chat path had no system prompt at all (generic model voice).
    const chatSettings = await getSettings().catch(() => null);
    history.unshift({
      role: 'system',
      content: buildChatSystemPrompt({
        customInstructions: chatSettings?.custom_instructions || undefined,
        webSearch: webModeForRoute,
      }),
    });

    // When the request is ambiguous, ask one concise clarifying question instead
    // of silently guessing whether the user wanted an answer or an action.
    if (clarify) {
      history.unshift({
        role: 'system',
        content: 'The user\'s request is ambiguous — it is unclear whether they want you to simply answer/explain, or to actually perform an action (create/modify files, use the browser, send something, schedule, etc.). Ask ONE short, friendly clarifying question to find out what they want before doing anything. Do not perform any action yet.',
      });
    }

    // Send the actual contents of attached references (text + images) so the
    // model can analyze them — not just their filenames. Stored/displayed
    // message stays plain `messageText`; only what we send to the model differs.
    if (searchMode !== 'none') {
      history.unshift({
        role: 'system',
        content: [
          `Runtime web route: ${webRouteDecision.strategy}. Search provider: ${webRouteDecision.provider}. ${webRouteDecision.reason}`,
          'Use live web search for current facts and answer with enough substance for a source-backed research response.',
          'Start with the direct answer, then add concise sections or bullets for evidence, context, dates/freshness, and caveats.',
          'Use inline citations when the API provides them. Every important factual claim, especially current or contested claims, should be grounded in a source.',
          'Prefer primary/reference sources when available. If sources disagree or are weak, say so plainly.',
          'Do not answer with only "I searched" or a short generic paragraph; synthesize what the sources show.',
          'Paraphrase sources instead of copying long passages. If search fails, say live search was unavailable before answering from general knowledge.',
        ].join('\n'),
      });
    }

    let userContent: ChatMessage['content'] = messageText;
    if (taskReferences.length > 0) {
      const resolved = await resolveReferencedContext({
        references: taskReferences,
        userId,
        workspaceId: projectId ?? undefined,
      });
      if (resolved.blockers.length > 0) {
        throw new Error(`Referenced context is not ready:\n${resolved.blockers.map((b) => `- ${b}`).join('\n')}`);
      }
      const ingest = await ingestReferences(resolved.documentReferences, text, { userId });
      const textBlocks = [...(resolved.promptBlock ? [resolved.promptBlock] : []), ...ingest.textBlocks];
      if (textBlocks.length > 0 || ingest.imageBlocks.length > 0) {
        const textPart = [messageText, ...textBlocks].join('\n\n');
        userContent = ingest.imageBlocks.length > 0
          ? [{ type: 'text', text: textPart }, ...ingest.imageBlocks]
          : textPart;
      }
    }
    history.push({ role: 'user', content: userContent });

    const serviceTier = 'service_tier' in modelDef ? (modelDef as any).service_tier : undefined;
    let fullContent = '';
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const completionStartedAt = Date.now();

    await callOpenRouter(
      history,
      modelDef.openrouter_id,
      userId,
      (chunk) => {
        fullContent += chunk;
        const parsed = parseLarundEnvelope(fullContent);
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId ? { ...m, content: parsed.answer, _thinking: parsed.thinking } : m,
        ));
      },
      async (usage) => {
        const totalTok = usage.inputTokens + usage.outputTokens;
        const searchLabel = usage.searchMode && usage.searchMode !== 'none'
          ? ` · ${usage.searchMode === 'deep' ? 'deep web' : 'web'}`
          : '';
        const usageStr = `${usage.model === 'perplexity/sonar-pro-search' ? 'Deep research' : modelDef.name}${searchLabel} · ${totalTok.toLocaleString()} tok · $${usage.costUsd.toFixed(5)}`;
        const citations = usage.citations ?? [];
        rememberSearchCitations(userId, citations);
        const parsed = parseLarundEnvelope(fullContent);
        const citedContent = injectCitationMarkers(parsed.answer, citations);
        const webSources = sourcesFromSearchCitations(citations);
        const webCitations = citationsToWebCitations(citations, webSources);
        const searchEvidence = buildChatSearchEvidence({
          route: webRouteDecision,
          modelId: usage.model,
          query: messageText,
          sources: webSources,
          citations: webCitations,
        });
        const run = searchRunFromChat(asstMsgId, messageText, usage.searchMode ?? searchMode, webSources.length);
        const webSearchRuns = run ? [run] : [];
        const quality = verifyWebAnswerQuality(citedContent, webSources, { webSearchMode: usage.searchMode ?? searchMode });
        const modelMetadata = buildAnswerModelMetadata({
          provider: 'openrouter',
          modelId: usage.model,
          displayName: usage.model === 'perplexity/sonar-pro-search' ? 'Deep research' : modelDef.name,
          tier: usage.model === 'perplexity/sonar-pro-search' ? 'deep_research' : modelTierFor(modelDef.tag),
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: usage.costUsd,
          searchCostUsd: usage.searchCostUsd,
          latencyMs: Date.now() - completionStartedAt,
          toolsUsed: (usage.searchMode ?? searchMode) !== 'none'
            ? [usage.model === 'perplexity/sonar-pro-search' ? 'perplexity_search_model' : 'openrouter:web_search']
            : [],
          webSearchMode: usage.searchMode ?? searchMode,
          searchStrategy: webRouteDecision.strategy,
          searchProvider: usage.model === 'perplexity/sonar-pro-search' ? 'perplexity' : webRouteDecision.provider,
          searchWarnings: webRouteDecision.strategy === 'provider_native_search' ? [] : [webRouteDecision.reason],
          webSearchRunsCount: webSearchRuns.length,
          webSourcesCount: webSources.length,
          quality,
        });
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId ? {
            ...m,
            content: citedContent,
            streaming: false,
            _usage: usageStr,
            _searchCitations: citations,
            _searchMode: usage.searchMode ?? searchMode,
            _webSearchRuns: webSearchRuns,
            _webSources: webSources,
            _webCitations: webCitations,
            _modelMetadata: modelMetadata,
            _searchEvidence: searchEvidence,
            _thinking: parsed.thinking,
          } : m,
        ));
        await addMessage(asstMsgId, sessionId!, 'assistant', citedContent, {
          search_citations_json: JSON.stringify(citations),
          search_mode: usage.searchMode ?? searchMode,
          web_search_runs_json: JSON.stringify(webSearchRuns),
          web_sources_json: JSON.stringify(webSources),
          web_citations_json: JSON.stringify(webCitations),
          model_metadata_json: JSON.stringify(modelMetadata),
          search_evidence_json: JSON.stringify(searchEvidence),
          thinking_json: serializeThinking(parsed.thinking),
        }).catch(err =>
          console.warn('Failed to save assistant message:', err),
        );
        setSending(false);
        setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
        onCreditsRefresh?.();
        if (isFirstExchange) void maybeGenerateTitle(sessionId!, messageText, citedContent);
        void runMemoryExtraction({
          userId: userId!,
          workspaceId: projectId ?? undefined,
          userText: messageText,
        });
      },
      (error) => {
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId
            ? { ...m, content: error, streaming: false, _error: true }
            : m,
        ));
        void addMessage(asstMsgId, sessionId!, 'assistant', error, {
          search_mode: searchMode,
        }).catch(err =>
          console.warn('Failed to save assistant error:', err),
        );
        setSending(false);
        setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
      },
      serviceTier,
      controller.signal,
      searchMode === 'none' ? undefined : {
        mode: searchMode,
        contextSize: 'medium',
        maxResults: searchMode === 'deep' ? 10 : 5,
        maxTotalResults: searchMode === 'deep' ? 25 : 10,
        messageId: asstMsgId,
      },
    );
    if (controller.signal.aborted) {
      const parsed = parseLarundEnvelope(fullContent);
      const stoppedContent = parsed.answer.trim() ? parsed.answer : fullContent.trim() ? fullContent : 'Stopped.';
      setMessages(prev => prev.map(m =>
        m.id === asstMsgId ? { ...m, content: stoppedContent, streaming: false, _thinking: parsed.thinking } : m,
      ));
      await addMessage(asstMsgId, sessionId!, 'assistant', stoppedContent, {
        thinking_json: serializeThinking(parsed.thinking),
      }).catch(err =>
        console.warn('Failed to save stopped assistant message:', err),
      );
    }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (currentTaskId) {
        setMessages(prev => prev.map(m =>
          m.id === currentTaskId ? { ...m, content: message, streaming: false, _error: true, _agentStatus: 'error' } : m,
        ));
        await addMessage(currentTaskId, currentSessionId!, 'assistant', message).catch(saveErr =>
          console.warn('Failed to save assistant error:', saveErr),
        );
      } else if (currentSessionId) {
        setMessages(prev => [...prev, {
          id: uuidv4(),
          session_id: currentSessionId!,
          role: 'assistant',
          content: message,
          created_at: new Date().toISOString(),
          _error: true,
        }]);
      } else {
        setMessages(prev => [...prev, {
          id: uuidv4(),
          session_id: activeChat ?? 'unsaved',
          role: 'assistant',
          content: message,
          created_at: new Date().toISOString(),
          _error: true,
        }]);
      }
    } finally {
      chatAbortRef.current = null;
      setSending(false);
      setRunningTask(prev => prev?.assistantMessageId === currentTaskId ? null : prev);
    }
  }

  const showNewChatPanel = activeChat === null && messages.length === 0;

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%', background: 'var(--bg-app)' }}>
      <Sidebar
        activeChat={activeChat}
        onChatChange={setActiveChat}
        userEmail={userEmail}
        projectId={projectId}
        refreshKey={sidebarRefreshKey}
        credits={credits}
      />

      <main className="chat-main">

        {/* ── Header ── */}
        {!showNewChatPanel && (
          <div className="chat-header">
            <Icon name="message" size={14} stroke={1.5} style={{ color: 'var(--text-hint)', flexShrink: 0 }} />
            <span className="chat-header-title">{chatTitle || 'Chat'}</span>
          </div>
        )}

        {/* ── Messages / new chat ── */}
        {showNewChatPanel ? (
          <div style={{ flex: 1, minHeight: 0 }}>
            <NewChatPanel onStarter={handleStarter} />
          </div>
        ) : (
          <div ref={scrollRef} className="scroll" style={{ flex: 1, minHeight: 0 }}>
            <div className="chat-col" style={{ padding: '28px 0 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {messagesLoading && messages.length === 0 && (
                  <AgentMsg>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>Loading conversation...</span>
                  </AgentMsg>
                )}

                {messagesError && (
                  <AgentMsg>
                    <div style={{ display: 'grid', gap: 10 }}>
                      <span style={{ color: 'var(--danger)', fontSize: 13.5 }}>Could not load this conversation.</span>
                      <button
                        className="btn btn-secondary"
                        onClick={() => activeChat && void loadMessagesForSession(activeChat)}
                        style={{ width: 'fit-content', height: 30, fontSize: 12.5 }}
                      >
                        Retry
                      </button>
                    </div>
                  </AgentMsg>
                )}

                {messages.map(msg => {
                  // ── User bubble ──
                  if (msg.role === 'user') {
                    return (
                      <UserMsg key={msg.id} initials={chatInitials(userEmail)}>
                        <div>{msg.content}</div>
                        {(msg._references?.length ?? 0) > 0 && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, justifyContent: 'flex-end' }}>
                            {msg._references!.map((ref) => {
                              const doc = mentionToDocumentReference(ref);
                              return doc ? <ReferenceChip key={ref.id} refItem={doc} /> : <MentionChip key={ref.id} refItem={ref} />;
                            })}
                          </div>
                        )}
                      </UserMsg>
                    );
                  }

                  // ── Agent execution bubble ──
                  if (msg._agent) {
                    const isRunning = msg._agentStatus !== 'complete' && msg._agentStatus !== 'error';
                    return (
                      <div key={msg.id} className="msg-group">
                        <div className="msg-ai-row">
                          <AiAvatar running={isRunning} />
                          <div className="msg-ai-body">
                            <AgentMsgContent
                              steps={msg._agentSteps ?? []}
                              status={msg._agentStatus ?? 'idle'}
                              askQuestion={msg._agentAskQuestion}
                              askAnswer={agentAskAnswer}
                              onAskAnswerChange={setAgentAskAnswer}
                              onAskSubmit={handleAskSubmit}
                              onAskQuickAnswer={handleAskQuickAnswer}
                              onStop={handleAgentStop}
                              finalText={msg.content || undefined}
                              isError={msg._error}
                              artifacts={msg._artifacts ?? []}
                              selectedArtifactId={previewState.selectedArtifactId}
                              onPreviewArtifact={previewArtifact}
                              onArtifactsChanged={refreshCurrentMessages}
                              userId={userId ?? undefined}
                              emailDraft={msg._emailDraft}
                              onEmailDraftChange={(d) => handleEmailDraftChange(msg.id, d)}
                              sources={msg._webSources ?? []}
                              modelMetadata={msg._modelMetadata}
                              thinking={msg._thinking ?? thinkingFromAgentSteps(msg._agentSteps ?? [])}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Normal AI bubble ──
                  return (
                    <div key={msg.id} className="msg-group">
                      {msg._intentLabel && !msg._error && (
                        <div style={{ paddingLeft: 44, marginBottom: 4, fontSize: 10.5, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span className="dot" style={{ width: 4, height: 4, background: msg._intentLabel === 'Needs confirmation' ? 'var(--warning)' : 'var(--accent)' }} />
                          {msg._intentLabel}
                        </div>
                      )}
                      <AgentMsg
                        rich={msg._error ? undefined : msg.content}
                        thinking={msg._thinking}
                        streaming={msg.streaming}
                        userId={userId ?? undefined}
                        citations={msg._searchCitations ?? []}
                        sources={msg._webSources ?? []}
                        modelMetadata={msg._modelMetadata}
                      >
                        {msg._error && (
                          <span style={{ color: 'var(--danger)', fontSize: 13.5 }}>{msg.content}</span>
                        )}
                      </AgentMsg>

                      {!msg.streaming && (
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          paddingLeft: 44, marginTop: 10, gap: 8,
                        }}>
                          {!msg._error && (
                            <div className="msg-actions">
                              <button
                                className="msg-action-btn"
                                onClick={() => handleCopyMessage(msg.id, msg.content)}
                                title="Copy response"
                              >
                                <Icon
                                  name={copiedId === msg.id ? 'check' : 'copy'}
                                  size={13} stroke={1.8}
                                  style={{ color: copiedId === msg.id ? 'var(--success)' : undefined }}
                                />
                              </button>
                            </div>
                          )}
                          {msg._usage && !msg._modelMetadata && (
                            <span className="msg-usage-pill" style={{ marginLeft: 'auto' }}>
                              <span style={{ color: 'var(--accent)', fontSize: 10 }}>◎</span>
                              {msg._usage}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                <div ref={bottomRef} />
              </div>
            </div>
          </div>
        )}

        {/* ── Input footer ── */}
        <div className="chat-footer">
          <div className="chat-col">
            <div
              className={`chat-input-box${sending || routing || runningTask ? ' composer-running' : ''}${composerDropActive ? ' chat-input-box--drop-active' : ''}`}
              onDragEnter={(e) => {
                e.preventDefault();
                setComposerDropActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!composerDropActive) setComposerDropActive(true);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setComposerDropActive(false);
              }}
              onDrop={handleReferenceDrop}
            >
              <ComposerAttachmentTray references={composerAttachments} onRemove={removeComposerAttachment} />

              {/* Rich composer: text with inline reference pills (mention-style) */}
              <RichMentionEditor
                ref={editorRef}
                value={input}
                references={references}
                onChange={handleEditorChange}
                userId={userId ?? ''}
                workspaceId={projectId ?? undefined}
                onKeyDown={onKeyDown}
                onPaste={handleComposerPaste}
                placeholder="Ask Larund anything, or describe a task…"
                minHeight={36}
              />
              <ReferencePicker
                open={referencePickerOpen}
                onPicked={handleReferencesPicked}
                onClose={() => setReferencePickerOpen(false)}
                triggerRef={referencePickerTriggerRef}
                userId={userId ?? ''}
              />

              {/* Toolbar */}
              <div className="chat-toolbar">
                <InlineModelPicker model={model} setModel={setModel} />

                <button
                  className={`composer-pill${webSearchPreference !== 'auto' ? ' composer-pill--active' : ''}`}
                  onClick={() => setWebSearchPreference((value) => value === 'auto' ? 'always' : value === 'always' ? 'never' : 'auto')}
                  title="Web search mode: Auto / Always / Never"
                >
                  <Icon name="globe" size={14} stroke={1.6} />
                  <span>{webSearchPreference === 'auto' ? 'Auto' : webSearchPreference === 'always' ? 'Web' : 'No web'}</span>
                </button>

                <button
                  className={`composer-pill${deepResearch ? ' composer-pill--active' : ''}`}
                  onClick={() => setDeepResearch((value) => !value)}
                  title="Deep research with Perplexity Sonar Pro Search"
                >
                  <Icon name="search" size={14} stroke={1.6} />
                  <span>Deep</span>
                </button>

                <button
                  ref={referencePickerTriggerRef}
                  className="toolbar-btn"
                  onClick={() => setReferencePickerOpen((open) => !open)}
                  title="Fájl vagy mappa csatolása"
                >
                  <Icon name="paperclip" size={15} stroke={1.5} />
                </button>

                <div style={{ flex: 1 }} />

                <button className="toolbar-btn" title="Voice input">
                  <Icon name="mic" size={15} stroke={1.5} />
                </button>

                <button
                  className={`send-btn${runningTask ? ' send-btn--stop send-stop-swap' : ''}`}
                  onClick={runningTask ? handleStop : handleSend}
                  disabled={!runningTask && (sending || (!!activeChat && messagesLoading) || (!input.trim() && references.length === 0 && composerAttachments.length === 0) || !userId)}
                  title={runningTask ? 'Stop' : 'Send (Enter)'}
                >
                  {runningTask
                    ? <Icon name="stop" size={12} stroke={2.4} />
                    : <Icon name="arrowUp" size={15} stroke={2.2} />
                  }
                </button>
              </div>
            </div>

            {/* Hint */}
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {routing ? (
                <>
                  <span className="dot dot-blue dot-pulse" style={{ width: 5, height: 5 }} />
                  <span style={{ color: 'rgba(var(--accent-rgb),.75)', fontWeight: 500 }}>Larund is deciding how to help…</span>
                </>
              ) : (
                'Larund answers questions and runs tasks automatically · Enter to send'
              )}
            </div>
          </div>
        </div>

      </main>
      <ArtifactPreviewRail
        artifacts={allArtifacts}
        state={previewState}
        onStateChange={setPreviewState}
        onChanged={refreshCurrentMessages}
      />
    </div>
  );
}
