import React, { forwardRef, useImperativeHandle, useRef, useCallback } from 'react';
import type { DocumentReference, DocumentReferenceKind } from '../../lib/references/types';

export interface MentionInputHandle {
  /** Insert a reference pill at the current caret (removes a trailing `@` trigger). */
  insertReference: (ref: DocumentReference) => void;
  /** Replace the whole content with plain text (used by prompt starters). */
  setText: (text: string) => void;
  /** Clear the editor. */
  clear: () => void;
  focus: () => void;
}

const ICON_PATH: Record<string, string> = {
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z',
  fileText: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z M14 2v5h5 M16 13H8 M16 17H8 M10 9H8',
  link: 'M9 17H7A5 5 0 0 1 7 7h2 M15 7h2a5 5 0 1 1 0 10h-2 M8 12h8',
};

function paletteFor(kind: DocumentReferenceKind): { icon: string; fg: string; bg: string; border: string } {
  switch (kind) {
    case 'folder':
      return { icon: 'folder', fg: '#e0a84e', bg: 'rgba(224,168,78,.15)', border: 'rgba(224,168,78,.45)' };
    case 'url':
      return { icon: 'link', fg: '#b48cff', bg: 'rgba(180,140,255,.15)', border: 'rgba(180,140,255,.45)' };
    default:
      return { icon: 'fileText', fg: 'var(--accent)', bg: 'rgba(var(--accent-rgb),.15)', border: 'rgba(var(--accent-rgb),.45)' };
  }
}

function iconSvg(path: string, color: string): string {
  return `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="${path}"/></svg>`;
}

/** Build an atomic, non-editable pill element representing a reference. */
function createPill(ref: DocumentReference): HTMLElement {
  const p = paletteFor(ref.kind);
  const pill = document.createElement('span');
  pill.className = 'mention-pill';
  pill.contentEditable = 'false';
  pill.dataset.ref = JSON.stringify(ref);
  pill.setAttribute('data-kind', ref.kind);
  pill.title = ref.path ?? ref.url ?? ref.label;
  pill.style.color = p.fg;
  pill.style.background = p.bg;
  pill.style.borderColor = p.border;
  pill.innerHTML = `${iconSvg(ICON_PATH[p.icon], p.fg)}<span class="mention-pill__label"></span>`;
  const label = pill.querySelector('.mention-pill__label');
  if (label) label.textContent = ref.label;
  return pill;
}

/** Walk the editor and derive the plain text plus the ordered references. */
function parseEditor(root: HTMLElement): { text: string; references: DocumentReference[] } {
  const references: DocumentReference[] = [];
  let text = '';
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent ?? '';
      } else if (child instanceof HTMLElement) {
        if (child.dataset.ref) {
          try {
            // A pill is a reference, not text — it is surfaced as a chip, so it
            // must NOT leak its label into the plain message text.
            references.push(JSON.parse(child.dataset.ref) as DocumentReference);
          } catch {
            /* ignore malformed pill */
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
  return { text: text.replace(/ /g, ' '), references };
}

export const MentionInput = forwardRef<MentionInputHandle, {
  onChange: (text: string, references: DocumentReference[]) => void;
  onTriggerPicker: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
}>(function MentionInput({ onChange, onTriggerPicker, onKeyDown, placeholder }, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  // Last caret position inside the editor — preserved so a pill can be inserted
  // at the right spot even after focus moves to the picker button.
  const savedRange = useRef<Range | null>(null);

  const saveSelection = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (editorRef.current && editorRef.current.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange();
    }
  }, []);

  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    const { text, references } = parseEditor(editorRef.current);
    onChange(text, references);
  }, [onChange]);

  const placeCaretAfter = (node: Node) => {
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange.current = range.cloneRange();
  };

  useImperativeHandle(ref, () => ({
    insertReference(reference: DocumentReference) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      // Restore the caret that was active before the picker stole focus.
      const sel = window.getSelection();
      let range = savedRange.current && editor.contains(savedRange.current.commonAncestorContainer)
        ? savedRange.current
        : null;
      if (!range) {
        range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
      }
      sel?.removeAllRanges();
      sel?.addRange(range);

      // Remove a trailing "@" trigger immediately before the caret, if present.
      if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
        const tn = range.startContainer as Text;
        if (tn.data[range.startOffset - 1] === '@') {
          tn.deleteData(range.startOffset - 1, 1);
          range.setStart(tn, range.startOffset - 1);
          range.collapse(true);
        }
      }

      const pill = createPill(reference);
      range.insertNode(pill);
      // Trailing space so the user can keep typing after the pill.
      const space = document.createTextNode(' ');
      pill.after(space);
      placeCaretAfter(space);
      emitChange();
    },
    setText(text: string) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.textContent = text;
      editor.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      savedRange.current = range.cloneRange();
      emitChange();
    },
    clear() {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = '';
      savedRange.current = null;
      emitChange();
    },
    focus() {
      editorRef.current?.focus();
    },
  }), [emitChange]);

  const handleInput = () => {
    const editor = editorRef.current;
    // Browsers leave a stray <br> after deleting all content, which defeats the
    // :empty placeholder — normalize a content-free editor back to truly empty.
    if (editor && editor.textContent === '' && !editor.querySelector('[data-ref]')) {
      if (editor.innerHTML !== '') editor.innerHTML = '';
    }
    saveSelection();
    emitChange();
    // Open the picker right after an "@" is typed (matches the legacy trigger).
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (r.collapsed && r.startContainer.nodeType === Node.TEXT_NODE && r.startOffset > 0) {
        const tn = r.startContainer as Text;
        if (tn.data[r.startOffset - 1] === '@') onTriggerPicker();
      }
    }
  };

  return (
    <div
      ref={editorRef}
      className="mention-input"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={placeholder}
      onInput={handleInput}
      onKeyUp={saveSelection}
      onMouseUp={saveSelection}
      onBlur={saveSelection}
      onKeyDown={onKeyDown}
    />
  );
});
