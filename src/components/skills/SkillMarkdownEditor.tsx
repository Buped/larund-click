import { input, labelStyle } from '../pages/ui';

export function SkillMarkdownEditor({ value, onChange, readOnly = false, minHeight = 260 }: {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  minHeight?: number;
}) {
  return (
    <div>
      <div style={{ ...labelStyle, marginBottom: 6 }}>Full instruction body</div>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange?.(e.target.value)}
        style={{ ...input, minHeight, resize: 'vertical', fontFamily: 'var(--font-mono)', lineHeight: 1.55, fontSize: 12 }}
      />
    </div>
  );
}
