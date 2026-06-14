import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, ClickMark } from './icons';
import { RichMessage } from './rich-message';
import { Sidebar } from './sidebar';
import { MODELS } from '../constants/models';
import { getMessages, addMessage, createSession, updateMessage, touchSession, getSettings } from '../lib/database';
import { callOpenRouter } from '../lib/openrouter';
import { runAgentLoop, AgentStatus, AgentStep, AgentAbortSignal } from '../lib/agent-loop';
import { v4 as uuidv4 } from 'uuid';
import type { UserCredits } from '../lib/supabase';
import { ReferenceChip } from './chat/ReferenceChip';
import { ReferencePicker } from './chat/ReferencePicker';
import type { DocumentReference } from '../lib/references/types';
import { appendReferenceSummary } from '../lib/references/serialize';
import { policyForAutonomyMode, type AutonomyMode as PolicyAutonomyMode } from '../lib/tools/policy';

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
        className="model-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          height: 28, padding: '0 9px',
          border: 'none', borderRadius: 7, fontSize: 12, cursor: 'pointer',
        }}
      >
        <Icon name={cur.icon} size={12} stroke={1.5} style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{cur.name}</span>
        <Icon
          name="chevronDown" size={10} stroke={1.5}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s', color: 'var(--text-hint)' }}
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
                  background: active ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                  color: active ? '#04122a' : 'var(--text-muted)',
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

function UserMsg({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ maxWidth: '78%', minWidth: 0 }}>
        <div className="msg-user-bubble">{children}</div>
      </div>
    </div>
  );
}

function AgentMsg({ children, rich, streaming }: {
  children?: React.ReactNode;
  rich?: string;
  streaming?: boolean;
}) {
  return (
    <div className="msg-ai-row">
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        <ClickMark size={24} radius={8} />
      </div>
      <div className="msg-ai-body">
        {rich != null ? (
          <>
            <RichMessage content={rich} />
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, marginBottom: 40 }}>
          <ClickMark size={54} radius={17} glow />
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: 26, fontWeight: 700, color: 'var(--text-primary)',
              letterSpacing: '-.03em', marginBottom: 10, lineHeight: 1.2,
            }}>
              How can I help you?
            </div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.5, maxWidth: 380 }}>
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
  'sheet.append':      'upload',
  'sheet.export_csv':  'upload',
  'sheet.to_json':     'fileText',
  'doc.read':          'fileText',
  'doc.write_txt':     'upload',
  'doc.write_docx':    'upload',
  'clipboard.get':     'fileText',
  'clipboard.set':     'upload',
  'app.open':          'externalLink',
  'window.focus':      'monitor',
  'window.list':       'monitor',
  'browser.open':      'externalLink',
  'browser.read':      'fileText',
  'connection.call':   'externalLink',
  'skill.run':         'sparkle',
  'workflow.start':    'monitor',
  'approval.request':  'sparkle',
  'task.complete':     'check',
  'ask_user':          'sparkle',
};

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
          background: 'rgba(74,158,255,0.12)',
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
    const toolName = step.tool || '';
    const iconName = TOOL_ICONS[toolName] || 'circle';
    let argPreview = '';
    try {
      const p = JSON.parse(step.input || '{}');
      argPreview = p.cmd || p.path || p.name || p.question || '';
    } catch { /* ignore */ }

    return (
      <div className="agent-step-item">
        <button
          onClick={() => step.input && setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            width: '100%', background: 'none', border: 'none',
            padding: '3px 0', cursor: step.input ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          <span style={{
            width: 18, height: 18, borderRadius: 4, flex: 'none',
            display: 'grid', placeItems: 'center',
            background: 'rgba(255,255,255,0.07)',
            color: 'var(--text-muted)',
          }}>
            <Icon name={iconName} size={9} stroke={1.8} />
          </span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', flex: 'none' }}>
            {toolName}
          </span>
          {argPreview && (
            <span style={{
              fontSize: 11.5, color: 'var(--text-hint)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1, maxWidth: 260,
            }}>
              {argPreview.slice(0, 70)}
            </span>
          )}
          {step.input && (
            <Icon
              name="chevronDown" size={9} stroke={1.5}
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
            margin: '3px 0 4px 24px', fontSize: 10.5,
            color: 'var(--text-hint)', fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            maxHeight: 110, overflow: 'auto',
            background: 'rgba(0,0,0,.3)', borderRadius: 5,
            padding: '5px 8px',
          }}>
            {step.input}
          </pre>
        )}
      </div>
    );
  }

  if (step.type === 'tool_result') {
    const hasErr = Boolean(step.error);
    const rawText = step.error || step.output || '';
    const preview = rawText.slice(0, 90);
    const hasMore = rawText.length > 90;

    return (
      <div className="agent-step-item">
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
  onStop: () => void;
  finalText?: string;
  isError?: boolean;
}

function AgentMsgContent({
  steps, status,
  askQuestion, askAnswer, onAskAnswerChange, onAskSubmit,
  onStop, finalText, isError,
}: AgentMsgContentProps) {
  const [stepsOpen, setStepsOpen] = useState(true);
  const isRunning = status !== 'complete' && status !== 'error';
  const callCount = steps.filter(s => s.type === 'tool_call').length;

  const headerLabel = isRunning
    ? ({ idle: 'Starting…', planning: 'Planning…', executing: 'Executing…', waiting_user: 'Waiting for input…' }[status] ?? 'Working…')
    : status === 'error'
      ? 'Failed'
      : `${callCount} ${callCount === 1 ? 'action' : 'actions'}`;

  return (
    <div style={{ width: '100%' }}>

      {/* ── Disclosure header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        marginBottom: stepsOpen && (steps.length > 0 || isRunning) ? 8 : 2,
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
        {false && isRunning && (
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
        {false && isRunning && (
          <span style={{ fontSize: 10.5, color: 'var(--text-hint)', marginLeft: 6 }}>
            vagy ESC
          </span>
        )}
      </div>

      {/* ── Steps list ── */}
      {stepsOpen && (steps.length > 0 || isRunning) && (
        <div style={{
          borderLeft: '1.5px solid var(--border-md)',
          paddingLeft: 10,
          marginBottom: finalText || askQuestion ? 12 : 0,
          display: 'flex', flexDirection: 'column',
        }}>
          {steps.map(step => <AgentStepItem key={step.id} step={step} />)}

          {/* Empty placeholder while starting */}
          {isRunning && steps.length === 0 && (
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
          border: '1px solid rgba(74,158,255,.22)',
          background: 'rgba(74,158,255,.05)',
        }}>
          <div style={{
            fontSize: 13, color: 'var(--text-primary)',
            marginBottom: 10, lineHeight: 1.55,
          }}>
            {askQuestion}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <input
              autoFocus
              value={askAnswer}
              onChange={e => onAskAnswerChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && askAnswer.trim()) onAskSubmit(); }}
              placeholder="Your answer…"
              style={{
                flex: 1, padding: '7px 11px', borderRadius: 7,
                border: '1px solid var(--border-md)',
                background: 'rgba(0,0,0,.35)',
                color: 'var(--text-primary)',
                fontSize: 13, fontFamily: 'inherit', outline: 'none',
              }}
              onFocus={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(74,158,255,.4)'; }}
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
            : <RichMessage content={finalText} />
          }
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
  _loading?: boolean;
  _usage?: string;
  _error?: boolean;
  streaming?: boolean;
  // Agent execution fields — UI-only, not persisted to DB
  _agent?: boolean;
  _agentStatus?: AgentStatus;
  _agentSteps?: AgentStep[];
  _agentAskQuestion?: string | null;
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

function hydrateMessage(row: any): Message {
  const isAgent = row.message_type === 'agent'
    || Boolean(row.agent_status || row.agent_steps_json || row.agent_ask_question);

  return {
    ...row,
    _agent: isAgent,
    _agentStatus: row.agent_status ?? undefined,
    _agentSteps: parseAgentSteps(row.agent_steps_json),
    _agentAskQuestion: row.agent_ask_question ?? null,
    _error: Boolean(row._error) || (isAgent && row.agent_status === 'error'),
  };
}

// ─── Main ChatScreen ──────────────────────────────────────────────────────────

export function ChatScreen({
  nav, model, setModel, userEmail, userId, credits, onCreditsRefresh,
}: {
  nav: (s: string) => void;
  model: string;
  setModel: (m: string) => void;
  userEmail?: string | null;
  userId?: string | null;
  credits?: UserCredits | null;
  onCreditsRefresh?: () => void;
}) {
  const [activeChat,        setActiveChat       ] = useState<string | null>(null);
  const [messages,          setMessages         ] = useState<Message[]>([]);
  const [input,             setInput            ] = useState('');
  const [sending,           setSending          ] = useState(false);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [attachments,       setAttachments      ] = useState<{ name: string; src: string }[]>([]);
  const [copiedId,          setCopiedId         ] = useState<string | null>(null);
  const [agentMode,         setAgentMode        ] = useState(false);
  const [agentAskAnswer,    setAgentAskAnswer   ] = useState('');
  const [runningTask,       setRunningTask      ] = useState<RunningTask | null>(null);
  const [references,        setReferences       ] = useState<DocumentReference[]>([]);
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);

  const taRef         = useRef<HTMLTextAreaElement>(null);
  const fileRef       = useRef<HTMLInputElement>(null);
  const bottomRef     = useRef<HTMLDivElement>(null);
  const skipNextFetch = useRef(false);
  const abortRef      = useRef<AgentAbortSignal>({ aborted: false });
  const chatAbortRef  = useRef<AbortController | null>(null);
  const askResolveRef = useRef<((answer: string) => void) | null>(null);

  useEffect(() => {
    if (!activeChat) { setMessages([]); return; }
    if (skipNextFetch.current) { skipNextFetch.current = false; return; }
    getMessages(activeChat).then(rows => setMessages(rows.map(hydrateMessage)));
  }, [activeChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const chatTitle = messages.find(m => m.role === 'user')?.content.slice(0, 80) ?? '';

  function growTextarea() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 130) + 'px';
  }

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    growTextarea();
    if (e.target.value.endsWith('@')) setReferencePickerOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files || []).forEach(file => {
      const reader = new FileReader();
      reader.onload = ev =>
        setAttachments(a => [...a, { name: file.name, src: ev.target!.result as string }]);
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function handleStarter(prompt: string) {
    setInput(prompt);
    setTimeout(() => {
      if (taRef.current) { taRef.current.focus(); growTextarea(); }
    }, 50);
  }

  function handleCopyMessage(id: string, content: string) {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
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

  async function handleAgentRun(
    task: string,
    sessionId: string,
    openrouterId: string,
    asstMsgId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    taskReferences: DocumentReference[],
  ) {
    type AgentPersistState = {
      content: string;
      status: AgentStatus;
      askQuestion: string | null;
      steps: AgentStep[];
    };

    let agentState: AgentPersistState = {
      content: '',
      status: 'planning',
      askQuestion: null,
      steps: [],
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
      };
      const payload = {
        content: snapshot.content,
        message_type: 'agent',
        agent_status: snapshot.status,
        agent_ask_question: snapshot.askQuestion,
        agent_steps_json: JSON.stringify(snapshot.steps.map(stripScreenshotFromStep)),
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
    };

    abortRef.current = { aborted: false };
    persistAgentState(agentState);

    const settings = await getSettings().catch(() => null);
    const autonomyMode = ((settings?.autonomy_mode as PolicyAutonomyMode | undefined) ?? 'semi');

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

        onComplete: (summary) => {
          syncAgentState(
            { content: summary, status: 'complete', askQuestion: null },
            { content: summary, _agentStatus: 'complete', _agentAskQuestion: null },
          );
          setSending(false);
          setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
          onCreditsRefresh?.();
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
      { sessionId, history, references: taskReferences, policy: policyForAutonomyMode(autonomyMode) },
    );

    await persistQueue;
  }

  async function handleSend() {
    const text = input.trim();
    const taskReferences = [...references];
    if ((!text && taskReferences.length === 0) || sending || runningTask || !userId) return;
    const messageText = appendReferenceSummary(text || 'Use the referenced input(s).', taskReferences);

    let currentTaskId: string | null = null;
    setSending(true);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    setAttachments([]);
    setReferences([]);
    try {

    // ── Create / get session ──
    let sessionId = activeChat;
    if (!sessionId) {
      sessionId = uuidv4();
      await createSession(sessionId, (text || taskReferences[0]?.label || 'Referenced task').slice(0, 40));
      skipNextFetch.current = true;
      setActiveChat(sessionId);
      setSidebarRefreshKey(k => k + 1);
    }

    // ── User message ──
    const userMsgId = uuidv4();
    setMessages(prev => [...prev, {
      id: userMsgId, session_id: sessionId!,
      role: 'user', content: messageText, created_at: new Date().toISOString(),
    }]);
    addMessage(userMsgId, sessionId, 'user', messageText).catch(err =>
      console.warn('Failed to save user message:', err),
    );

    const modelDef = MODELS.find(m => m.id === model) ?? MODELS[1];

    // ── Agent mode path ──
    if (agentMode) {
      // Prior conversation for the agent loop: user messages and any agent/AI
      // final summaries, oldest first. Gives the operator real context so a
      // correction continues the previous task instead of restarting it.
      const agentHistory = messages
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
      }).catch(err => console.warn('Failed to save agent message shell:', err));
      await handleAgentRun(text || messageText, sessionId, modelDef.openrouter_id, asstMsgId, agentHistory, taskReferences);
      return;
    }

    // ── Normal chat path ──
    const asstMsgId = uuidv4();
    currentTaskId = asstMsgId;
    setMessages(prev => [...prev, {
      id: asstMsgId, session_id: sessionId!, role: 'assistant',
      content: '', created_at: new Date().toISOString(), streaming: true,
    }]);
    setRunningTask({ kind: 'chat', assistantMessageId: asstMsgId, sessionId: sessionId! });

    const history = messages
      .filter(m => !m._loading && !m.streaming && !m._agent && m.content)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    history.push({ role: 'user', content: messageText });

    const serviceTier = 'service_tier' in modelDef ? (modelDef as any).service_tier : undefined;
    let fullContent = '';
    const controller = new AbortController();
    chatAbortRef.current = controller;

    await callOpenRouter(
      history,
      modelDef.openrouter_id,
      userId,
      (chunk) => {
        fullContent += chunk;
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId ? { ...m, content: fullContent } : m,
        ));
      },
      async (usage) => {
        const totalTok = usage.inputTokens + usage.outputTokens;
        const usageStr = `${modelDef.name} · ${totalTok.toLocaleString()} tok · $${usage.costUsd.toFixed(5)}`;
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId ? { ...m, streaming: false, _usage: usageStr } : m,
        ));
        await addMessage(asstMsgId, sessionId!, 'assistant', fullContent).catch(err =>
          console.warn('Failed to save assistant message:', err),
        );
        setSending(false);
        setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
        onCreditsRefresh?.();
      },
      (error) => {
        setMessages(prev => prev.map(m =>
          m.id === asstMsgId
            ? { ...m, content: error, streaming: false, _error: true }
            : m,
        ));
        setSending(false);
        setRunningTask(prev => prev?.assistantMessageId === asstMsgId ? null : prev);
      },
      serviceTier,
      controller.signal,
    );
    if (controller.signal.aborted) {
      const stoppedContent = fullContent.trim() ? fullContent : 'Stopped.';
      setMessages(prev => prev.map(m =>
        m.id === asstMsgId ? { ...m, content: stoppedContent, streaming: false } : m,
      ));
      await addMessage(asstMsgId, sessionId!, 'assistant', stoppedContent).catch(err =>
        console.warn('Failed to save stopped assistant message:', err),
      );
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
        nav={nav}
        activeChat={activeChat}
        onChatChange={setActiveChat}
        userEmail={userEmail}
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
          <div className="scroll" style={{ flex: 1, minHeight: 0 }}>
            <div className="chat-col" style={{ padding: '28px 0 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

                {messages.map(msg => {
                  // ── User bubble ──
                  if (msg.role === 'user') {
                    return <UserMsg key={msg.id}>{msg.content}</UserMsg>;
                  }

                  // ── Agent execution bubble ──
                  if (msg._agent) {
                    const isRunning = msg._agentStatus !== 'complete' && msg._agentStatus !== 'error';
                    return (
                      <div key={msg.id} className="msg-group">
                        <div className="msg-ai-row">
                          <div style={{ flexShrink: 0, marginTop: 1 }}>
                            <ClickMark size={24} radius={8} glow={isRunning} />
                          </div>
                          <div className="msg-ai-body">
                            <AgentMsgContent
                              steps={msg._agentSteps ?? []}
                              status={msg._agentStatus ?? 'idle'}
                              askQuestion={msg._agentAskQuestion}
                              askAnswer={agentAskAnswer}
                              onAskAnswerChange={setAgentAskAnswer}
                              onAskSubmit={handleAskSubmit}
                              onStop={handleAgentStop}
                              finalText={msg.content || undefined}
                              isError={msg._error}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // ── Normal AI bubble ──
                  return (
                    <div key={msg.id} className="msg-group">
                      <AgentMsg
                        rich={msg._error ? undefined : msg.content}
                        streaming={msg.streaming}
                      >
                        {msg._error && (
                          <span style={{ color: 'var(--danger)', fontSize: 13.5 }}>{msg.content}</span>
                        )}
                      </AgentMsg>

                      {!msg.streaming && (
                        <div style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          paddingLeft: 36, marginTop: 10, gap: 8,
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
                          {msg._usage && (
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
              className={`chat-input-box${agentMode ? ' chat-input-box--agent' : ''}${runningTask ? ' chat-input-box--working' : ''}`}
            >

              {/* Attachment previews */}
              {attachments.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {attachments.map((att, i) => (
                    <div key={i} style={{
                      width: 68, height: 68, borderRadius: 10, overflow: 'hidden',
                      position: 'relative', flex: 'none', border: '1px solid var(--border-md)',
                    }}>
                      <img src={att.src} alt={att.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <button
                        onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                        style={{
                          position: 'absolute', top: 3, right: 3,
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'rgba(0,0,0,.75)', border: 'none',
                          cursor: 'pointer', display: 'grid', placeItems: 'center', color: '#fff',
                        }}
                      >
                        <Icon name="x" size={9} stroke={2.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Textarea */}
              <textarea
                ref={taRef}
                value={input}
                onChange={onInputChange}
                onKeyDown={onKeyDown}
                placeholder={agentMode ? 'Describe a task for the agent…' : 'Tell Click what to do…'}
                rows={1}
                className="chat-textarea"
              />
              {references.length > 0 && (
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 8, marginBottom: 2 }}>
                  {references.map((ref) => (
                    <ReferenceChip
                      key={ref.id}
                      refItem={ref}
                      onRemove={() => setReferences((current) => current.filter((item) => item.id !== ref.id))}
                    />
                  ))}
                </div>
              )}
              <ReferencePicker
                open={referencePickerOpen}
                onPicked={(picked) => setReferences((current) => [...current, ...picked])}
                onClose={() => setReferencePickerOpen(false)}
              />

              {/* Toolbar */}
              <div className="chat-toolbar">
                <InlineModelPicker model={model} setModel={setModel} />

                {/* Agent mode toggle — ⚡ zap icon */}
                <button
                  className="toolbar-btn"
                  onClick={() => setAgentMode(v => !v)}
                  title={agentMode ? 'Agent mode ON — click to turn off' : 'Turn on Agent mode'}
                  style={{
                    color: agentMode ? 'var(--accent)' : undefined,
                    background: agentMode ? 'rgba(74,158,255,.12)' : undefined,
                    boxShadow: agentMode ? '0 0 0 1px rgba(74,158,255,.25)' : undefined,
                    borderRadius: 8,
                  }}
                >
                  <Icon name="zap" size={15} stroke={1.5} />
                </button>

                <button
                  className="toolbar-btn"
                  onClick={() => setReferencePickerOpen((open) => !open)}
                  title="Attach file, folder, or URL reference"
                >
                  <Icon name="paperclip" size={15} stroke={1.5} />
                </button>
                <input
                  ref={fileRef} type="file" accept="image/*" multiple
                  onChange={handleFiles} style={{ display: 'none' }}
                />

                <div style={{ flex: 1 }} />

                <button className="toolbar-btn" title="Voice input">
                  <Icon name="mic" size={15} stroke={1.5} />
                </button>

                <button
                  className={`send-btn${runningTask ? ' send-btn--stop send-stop-swap' : ''}`}
                  onClick={runningTask ? handleStop : handleSend}
                  disabled={!runningTask && (sending || (!input.trim() && references.length === 0) || !userId)}
                  title={runningTask ? 'Stop' : 'Send (Enter)'}
                >
                  {runningTask
                    ? <Icon name="stop" size={12} stroke={2.4} />
                    : agentMode
                    ? <Icon name="zap" size={14} stroke={2} />
                    : <Icon name="arrowUp" size={15} stroke={2.2} />
                  }
                </button>
              </div>
            </div>

            {/* Hint */}
            <div style={{ textAlign: 'center', marginTop: 8, fontSize: 11, color: 'var(--text-hint)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {agentMode ? (
                <>
                  <span className="dot dot-blue" style={{ width: 5, height: 5 }} />
                  <span style={{ color: 'rgba(74,158,255,.7)', fontWeight: 500 }}>Agent mode</span>
                  <span>— AI uses tools to complete tasks on your computer</span>
                </>
              ) : (
                'Enter to send · Shift+Enter for new line'
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
