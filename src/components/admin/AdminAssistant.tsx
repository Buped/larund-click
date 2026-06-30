import { useState } from 'react';
import { Icon } from '../icons';
import { buildAutomationFromAdminText } from '../../lib/automations/admin-builder';
import type { DependencyReport } from '../../lib/automations/dependencies';
import type { AdminSkillDraft } from '../../lib/automations/admin-skill-builder';
import { approveSharedSkill, saveSkillForReview } from '../../lib/skills/shared-store';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  report?: DependencyReport;
  skillDrafts?: AdminSkillDraft[];
};

export function AdminAssistant({
  userId,
  projectId,
  isAdmin,
  onCreated,
  onOpenAutomations,
}: {
  userId: string;
  projectId?: string | null;
  isAdmin: boolean;
  onCreated?: (automationId: string) => void;
  onOpenAutomations?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'hello',
      role: 'assistant',
      text: 'Paste the workflow instructions and I will create a full automation draft.',
    },
  ]);

  if (!isAdmin) return null;

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const userMessage: Message = { id: `m-${Date.now()}-u`, role: 'user', text: trimmed };
    setMessages((prev) => [...prev, userMessage]);
    setText('');
    setBusy(true);
    try {
      const result = await buildAutomationFromAdminText({
        userId,
        projectId: projectId ?? undefined,
        isAdmin,
        text: trimmed,
      });
      const blockerText = result.dependencyReport.blockers.length
        ? ` ${result.dependencyReport.blockers.length} dependency blocker needs attention before enabling.`
        : ' It is ready to review and test.';
      const setupText = result.setupRunId ? ` One-time setup started: ${result.setupRunId.slice(0, 16)}...` : '';
      const warningText = result.warnings.length ? ` ${result.warnings.join(' ')}` : '';
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${Date.now()}-a`,
          role: 'assistant',
          text: `Draft created: ${result.automation.name}.${blockerText}${setupText}${warningText}`,
          report: result.dependencyReport,
          skillDrafts: result.skillDrafts,
        },
      ]);
      onCreated?.(result.automation.id);
    } catch (error) {
      const message = error instanceof Error && error.message === 'admin_required'
        ? 'Admin permission is required for this action.'
        : error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, { id: `m-${Date.now()}-e`, role: 'assistant', text: message }]);
    } finally {
      setBusy(false);
    }
  }

  function updateSkillDraft(messageId: string, index: number, patch: Partial<AdminSkillDraft['skill']>) {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !message.skillDrafts) return message;
      return {
        ...message,
        skillDrafts: message.skillDrafts.map((draft, i) => i === index ? { ...draft, skill: { ...draft.skill, ...patch } } : draft),
      };
    }));
  }

  async function saveWorkspaceSkill(messageId: string, draft: AdminSkillDraft) {
    try {
      await saveSkillForReview({
        skill: { ...draft.skill, status: 'approved', enabled: true },
        source: 'admin_authored',
        userId,
        workspaceId: projectId ?? draft.skill.workspaceId,
        status: 'approved',
        originAutomationId: draft.skill.originAutomationId,
      });
      setMessages((prev) => [...prev, { id: `m-${Date.now()}-skill`, role: 'assistant', text: `Workspace skill saved: ${draft.skill.name}` }]);
      markDraftSaved(messageId, draft.skill.id, 'Saved workspace skill');
    } catch (error) {
      setMessages((prev) => [...prev, { id: `m-${Date.now()}-skill-e`, role: 'assistant', text: `Skill save failed: ${error instanceof Error ? error.message : String(error)}` }]);
    }
  }

  async function approveGlobalSkill(messageId: string, draft: AdminSkillDraft) {
    try {
      const pending = await saveSkillForReview({
        skill: { ...draft.skill, status: 'pending_review', enabled: false },
        source: 'admin_authored',
        userId,
        workspaceId: projectId ?? draft.skill.workspaceId,
        status: 'pending_review',
        originAutomationId: draft.skill.originAutomationId,
      });
      await approveSharedSkill(pending.id, { makeGlobal: true });
      setMessages((prev) => [...prev, { id: `m-${Date.now()}-skill`, role: 'assistant', text: `Approved shared skill: ${draft.skill.name}` }]);
      markDraftSaved(messageId, draft.skill.id, 'Approved shared skill');
    } catch (error) {
      setMessages((prev) => [...prev, { id: `m-${Date.now()}-skill-e`, role: 'assistant', text: `Shared approval failed: ${error instanceof Error ? error.message : String(error)}` }]);
    }
  }

  function markDraftSaved(messageId: string, skillId: string, label: string) {
    setMessages((prev) => prev.map((message) => {
      if (message.id !== messageId || !message.skillDrafts) return message;
      return {
        ...message,
        skillDrafts: message.skillDrafts.map((draft) => draft.skill.id === skillId ? { ...draft, warnings: [...draft.warnings, label] } : draft),
      };
    }));
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Admin Assistant"
          style={{
            position: 'fixed',
            right: 22,
            bottom: 22,
            zIndex: 70,
            width: 48,
            height: 48,
            borderRadius: 24,
            border: '1px solid var(--border-md)',
            background: 'var(--accent)',
            color: 'var(--on-accent)',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 12px 34px rgba(0,0,0,0.24)',
            cursor: 'pointer',
          }}
        >
          <Icon name="sparkle" size={19} stroke={1.9} />
        </button>
      )}

      {open && (
        <aside
          aria-label="Admin Assistant"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            top: 16,
            width: 'min(430px, calc(100vw - 32px))',
            zIndex: 70,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-md)',
            borderRadius: 8,
            boxShadow: '0 18px 55px rgba(0,0,0,0.28)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{ height: 48, padding: '0 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
              <Icon name="shield" size={16} stroke={1.8} />
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>Admin Assistant</div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              title="Close"
              style={{ width: 30, height: 30, borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-muted)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
            >
              <Icon name="x" size={14} stroke={1.8} />
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '92%',
                  borderRadius: 8,
                  padding: '9px 11px',
                  border: '1px solid var(--border-subtle)',
                  background: message.role === 'user' ? 'var(--accent-soft)' : 'var(--bg-panel)',
                  color: 'var(--text-primary)',
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {message.text}
                {message.report && (message.report.blockers.length > 0 || message.report.warnings.length > 0) && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {message.report.blockers.slice(0, 3).map((issue) => (
                      <div key={`b-${issue.kind}-${issue.refId}`} style={{ color: 'var(--danger)' }}>{issue.message}</div>
                    ))}
                    {message.report.warnings.slice(0, 3).map((issue) => (
                      <div key={`w-${issue.kind}-${issue.refId}`} style={{ color: 'var(--warning)' }}>{issue.message}</div>
                    ))}
                  </div>
                )}
                {message.skillDrafts && message.skillDrafts.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {message.skillDrafts.map((draft, index) => (
                      <div key={draft.skill.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 9, background: 'var(--bg-elevated)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
                          <Icon name="sparkle" size={13} stroke={1.7} />
                          <strong style={{ fontSize: 12.5 }}>Skill draft</strong>
                          <span style={{ fontSize: 11, color: 'var(--text-hint)' }}>{draft.proposedScope}</span>
                          <span style={{ fontSize: 11, color: draft.dryRun.ok ? 'var(--success)' : 'var(--danger)' }}>{draft.dryRun.ok ? 'dry-run ok' : 'dry-run issue'}</span>
                        </div>
                        <input
                          value={draft.skill.name}
                          onChange={(event) => updateSkillDraft(message.id, index, { name: event.target.value })}
                          style={{ width: '100%', boxSizing: 'border-box', borderRadius: 6, border: '1px solid var(--border-md)', background: 'var(--bg-input)', color: 'var(--text-primary)', padding: '7px 8px', fontSize: 12, marginBottom: 6 }}
                        />
                        <textarea
                          value={draft.skill.description}
                          onChange={(event) => updateSkillDraft(message.id, index, { description: event.target.value })}
                          style={{ width: '100%', boxSizing: 'border-box', minHeight: 58, resize: 'vertical', borderRadius: 6, border: '1px solid var(--border-md)', background: 'var(--bg-input)', color: 'var(--text-primary)', padding: '7px 8px', fontSize: 12, lineHeight: 1.35 }}
                        />
                        <div style={{ marginTop: 6, fontSize: 11.2, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                          Tools: {draft.skill.allowedTools.join(', ') || 'none'} · Risk: {draft.skill.riskLevel}
                        </div>
                        {(draft.dryRun.errors.length > 0 || draft.warnings.length > 0) && (
                          <div style={{ marginTop: 6, fontSize: 11.2, color: draft.dryRun.errors.length ? 'var(--danger)' : 'var(--warning)' }}>
                            {[...draft.dryRun.errors, ...draft.warnings].slice(0, 4).join(' ')}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
                          <button type="button" onClick={() => void saveWorkspaceSkill(message.id, draft)} style={{ height: 28, padding: '0 9px', borderRadius: 6, border: '1px solid var(--border-md)', background: 'transparent', color: 'var(--text-primary)', fontSize: 11.5, cursor: 'pointer' }}>
                            Save as workspace skill
                          </button>
                          <button type="button" onClick={() => void approveGlobalSkill(message.id, draft)} style={{ height: 28, padding: '0 9px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--on-accent)', fontSize: 11.5, cursor: 'pointer' }}>
                            Approve to shared library
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--border-subtle)', padding: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the full workflow instructions..."
              disabled={busy}
              style={{
                minHeight: 118,
                maxHeight: 240,
                resize: 'vertical',
                borderRadius: 8,
                border: '1px solid var(--border-md)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                padding: 10,
                fontFamily: 'var(--font)',
                fontSize: 13,
                lineHeight: 1.45,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
              <button
                type="button"
                onClick={onOpenAutomations}
                style={{ height: 34, padding: '0 11px', borderRadius: 6, border: '1px solid var(--border-md)', background: 'transparent', color: 'var(--text-muted)', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <Icon name="zap" size={13} stroke={1.7} />
                Automations
              </button>
              <button
                type="button"
                disabled={busy || !text.trim()}
                onClick={submit}
                style={{
                  height: 34,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: '1px solid var(--accent)',
                  background: busy || !text.trim() ? 'var(--bg-muted)' : 'var(--accent)',
                  color: busy || !text.trim() ? 'var(--text-hint)' : 'var(--on-accent)',
                  fontSize: 12.5,
                  fontWeight: 650,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: busy || !text.trim() ? 'default' : 'pointer',
                }}
              >
                <Icon name={busy ? 'circle' : 'send'} size={13} stroke={1.7} />
                {busy ? 'Building...' : 'Create draft'}
              </button>
            </div>
          </div>
        </aside>
      )}
    </>
  );
}
