import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MENTION_COLORS, type MentionKind, type ReferencedContext } from '../../lib/mentions/types';
import { MentionDropdown } from './MentionDropdown';
import { useMentionResources } from './useMentionResources';

export interface RichMentionEditorHandle {
  insertReference: (ref: ReferencedContext) => void;
  setText: (text: string) => void;
  clear: () => void;
  focus: () => void;
}

function chipHtml(ref: ReferencedContext): string {
  const color = MENTION_COLORS[ref.kind];
  const json = encodeURIComponent(JSON.stringify(ref));
  const kind = `${ref.kind[0].toUpperCase()}${ref.kind.slice(1)}`;
  return `<span class="rich-mention-chip" contenteditable="false" data-mention="${json}" data-kind="${ref.kind}" style="--mention-color:${color};">${kind} · ${escapeHtml(ref.label)}</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

function parseEditor(root: HTMLElement): { text: string; refs: ReferencedContext[] } {
  let text = '';
  const refs: ReferencedContext[] = [];
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
      } else if (child instanceof HTMLElement) {
        if (child.dataset.mention) {
          try {
            const ref = JSON.parse(decodeURIComponent(child.dataset.mention)) as ReferencedContext;
            refs.push(ref);
            text += ref.displayText;
          } catch {
            text += child.textContent ?? '';
          }
        } else if (child.tagName === 'BR') {
          text += '\n';
        } else {
          walk(child);
        }
      }
    });
  };
  walk(root);
  return { text: text.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n'), refs };
}

function activeMentionQuery(editor: HTMLElement): { start: number; query: string; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  if (range.startContainer.nodeType !== Node.TEXT_NODE) {
    return { start: 0, query: '', rect: caretRect(range) ?? editor.getBoundingClientRect() };
  }
  const node = range.startContainer as Text;
  const before = node.data.slice(0, range.startOffset);
  const match = before.match(/(^|\s)@([^\s@]*)$/);
  if (!match) return null;
  return { start: range.startOffset - match[2].length - 1, query: match[2], rect: caretRect(range) ?? editor.getBoundingClientRect() };
}

function caretRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  const cloned = range.cloneRange();
  cloned.insertNode(marker);
  const out = marker.getBoundingClientRect();
  marker.remove();
  return out;
}

export const RichMentionEditor = forwardRef<RichMentionEditorHandle, {
  value: string;
  references: ReferencedContext[];
  onChange: (text: string, refs: ReferencedContext[]) => void;
  userId: string;
  workspaceId?: string;
  kinds?: MentionKind[];
  placeholder?: string;
  minHeight?: number;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}>(function RichMentionEditor({ value, references, onChange, userId, workspaceId, kinds, placeholder, minHeight = 90, onKeyDown }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const { items } = useMentionResources({ userId, workspaceId, kinds, active: open });

  const refsKey = useMemo(() => references.map((r) => r.id).join('|'), [references]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === '' && references.length === 0 && editor.innerHTML !== '') editor.innerHTML = '';
  }, [value, refsKey, references.length]);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editorRef.current) return;
    const range = sel.getRangeAt(0);
    if (editorRef.current.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange();
  }, []);

  const emit = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.textContent === '' && !editor.querySelector('[data-mention]')) editor.innerHTML = '';
    const parsed = parseEditor(editor);
    onChange(parsed.text, parsed.refs);
    const active = activeMentionQuery(editor);
    if (active) {
      setQuery(active.query);
      setAnchorRect(active.rect);
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [onChange]);

  function placeCaretAfter(node: Node) {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange.current = range.cloneRange();
  }

  function restoreRange(): Range | null {
    const editor = editorRef.current;
    if (!editor) return null;
    editor.focus();
    const sel = window.getSelection();
    let range = savedRange.current && editor.contains(savedRange.current.commonAncestorContainer) ? savedRange.current : null;
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    sel?.removeAllRanges();
    sel?.addRange(range);
    return range;
  }

  function insertReference(refItem: ReferencedContext) {
    const editor = editorRef.current;
    if (!editor) return;
    const range = restoreRange();
    if (!range) return;
    const active = activeMentionQuery(editor);
    if (active && range.startContainer.nodeType === Node.TEXT_NODE) {
      const tn = range.startContainer as Text;
      tn.deleteData(active.start, range.startOffset - active.start);
      range.setStart(tn, active.start);
      range.collapse(true);
    }
    const template = document.createElement('template');
    template.innerHTML = chipHtml(refItem);
    const chip = template.content.firstChild as HTMLElement;
    range.insertNode(chip);
    const space = document.createTextNode('\u00a0');
    chip.after(space);
    placeCaretAfter(space);
    setOpen(false);
    emit();
  }

  useImperativeHandle(ref, () => ({
    insertReference,
    setText(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.textContent = text;
      placeCaretAfter(editor.lastChild ?? editor);
      emit();
    },
    clear() {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = '';
      savedRange.current = null;
      setOpen(false);
      emit();
    },
    focus() { editorRef.current?.focus(); },
  }), [emit]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
          const prev = (range.startContainer as Text).previousSibling;
          if (prev instanceof HTMLElement && prev.dataset.mention) {
            event.preventDefault();
            prev.remove();
            emit();
            return;
          }
        }
      }
    }
    onKeyDown?.(event);
  }

  return (
    <>
      <div
        ref={editorRef}
        className="rich-mention-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder ?? 'Describe what Larund should do... type @ to add context.'}
        style={{ minHeight }}
        onInput={emit}
        onKeyDown={handleKeyDown}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        onBlur={saveSelection}
        onFocus={saveSelection}
      />
      <MentionDropdown
        open={open}
        anchorRect={anchorRect}
        resources={items}
        query={query}
        kinds={kinds}
        onPick={insertReference}
        onClose={() => setOpen(false)}
      />
    </>
  );
});
