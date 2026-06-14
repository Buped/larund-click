import React from 'react';
import type { DocumentReference } from '../../lib/references/types';
import { ReferenceChip } from './ReferenceChip';

export function RichChatInput({ text, references, onTextChange, onRemoveReference, textareaRef, onKeyDown, placeholder }: {
  text: string;
  references: DocumentReference[];
  onTextChange: (value: string) => void;
  onRemoveReference: (id: string) => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
}) {
  return (
    <>
      {references.length > 0 && (
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 8 }}>
          {references.map((ref) => (
            <ReferenceChip key={ref.id} refItem={ref} onRemove={() => onRemoveReference(ref.id)} />
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
        className="chat-textarea"
      />
    </>
  );
}
