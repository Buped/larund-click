import { useEffect, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import type { DocumentArtifactModel, DocumentSection, ListItem, TextRun } from '../../../lib/artifacts/types';
import { getArtifactText, getArtifactSourceModel } from '../../../lib/artifacts/actions';
import { PreviewError, PreviewLoading } from './PdfArtifactViewer';

export function DocxArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [model, setModel] = useState<DocumentArtifactModel | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    setModel(null);
    setText('');
    setError('');
    // Prefer the structured source model (true heading/list/table hierarchy);
    // fall back to extracted plain text when no model is stored.
    getArtifactSourceModel<DocumentArtifactModel>(artifact.artifactId)
      .then((m) => { if (!disposed && m && Array.isArray(m.sections)) setModel(m); else throw new Error('no-model'); })
      .catch(() => {
        getArtifactText(artifact)
          .then((value) => { if (!disposed) setText(value); })
          .catch((err) => { if (!disposed) setError(String(err instanceof Error ? err.message : err)); });
      });
    return () => { disposed = true; };
  }, [artifact]);

  if (error) return <PreviewError message={error} />;
  if (!model && !text) return <PreviewLoading label="Extracting document preview..." />;

  return (
    <div style={{ height: '100%', overflow: 'auto', background: '#303238', padding: 24 }}>
      <div style={{ maxWidth: 780, margin: '0 auto', background: '#f8fafc', color: '#111827', borderRadius: 4, padding: 44, lineHeight: 1.65, boxShadow: '0 18px 50px rgba(0,0,0,.32)' }}>
        {model ? <ModelPreview model={model} /> : (
          <>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', color: '#64748b', marginBottom: 18 }}>
              Preview from extracted text. Open in Word/LibreOffice for full fidelity.
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'Segoe UI, Arial, sans-serif', fontSize: 13, margin: 0 }}>{text}</pre>
          </>
        )}
      </div>
    </div>
  );
}

function ModelPreview({ model }: { model: DocumentArtifactModel }) {
  const primary = model.brand?.primary ?? '#1F2937';
  const accent = model.brand?.accent ?? '#EE7E3A';
  const muted = model.brand?.mutedText ?? '#64748B';
  const firstIsCover = model.sections[0]?.type === 'cover';
  return (
    <div>
      {!firstIsCover && (
        <>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: primary, margin: '0 0 4px' }}>{model.title}</h1>
          {model.subtitle && <div style={{ fontSize: 15, color: muted, marginBottom: 16 }}>{model.subtitle}</div>}
        </>
      )}
      {model.sections.map((section, i) => (
        <SectionView key={i} section={section} model={model} primary={primary} accent={accent} muted={muted} />
      ))}
    </div>
  );
}

function runsView(node: { text?: string; runs?: TextRun[] }): React.ReactNode {
  if (node.runs && node.runs.length > 0) {
    return node.runs.map((r, i) => {
      const style: React.CSSProperties = {
        fontWeight: r.bold ? 700 : undefined,
        fontStyle: r.italic ? 'italic' : undefined,
        textDecoration: r.underline || r.link ? 'underline' : undefined,
        color: r.color,
      };
      return r.link
        ? <a key={i} href={r.link} style={style}>{r.text}</a>
        : <span key={i} style={style}>{r.text}</span>;
    });
  }
  return node.text ?? '';
}

function ListView({ items, ordered }: { items: ListItem[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <Tag style={{ fontSize: 13.5, paddingLeft: 22, margin: '0 0 12px' }}>
      {items.map((item, i) => (
        <li key={i} style={{ margin: '3px 0' }}>
          {runsView(item)}
          {item.children && item.children.length > 0 && <ListView items={item.children} ordered={ordered} />}
        </li>
      ))}
    </Tag>
  );
}

function SectionView({ section, model, primary, accent, muted }: {
  section: DocumentSection;
  model: DocumentArtifactModel;
  primary: string;
  accent: string;
  muted: string;
}) {
  switch (section.type) {
    case 'cover':
      return (
        <div style={{ borderBottom: `3px solid ${accent}`, paddingBottom: 16, marginBottom: 22 }}>
          {section.kicker && <div style={{ textTransform: 'uppercase', letterSpacing: '.12em', fontSize: 11, fontWeight: 700, color: accent }}>{section.kicker}</div>}
          <h1 style={{ fontSize: 32, fontWeight: 800, color: primary, margin: '4px 0' }}>{section.title}</h1>
          {section.subtitle && <div style={{ fontSize: 15, color: muted }}>{section.subtitle}</div>}
          {section.summary && <p style={{ fontSize: 13.5 }}>{section.summary}</p>}
        </div>
      );
    case 'heading': {
      const size = section.level === 1 ? 24 : section.level === 2 ? 19 : 15;
      return <div style={{ fontSize: size, fontWeight: 700, color: section.level === 3 ? accent : primary, margin: '20px 0 8px' }}>{section.text}</div>;
    }
    case 'paragraph':
      return <p style={{ fontSize: 13.5, margin: '0 0 10px' }}>{runsView(section)}</p>;
    case 'list':
      return <ListView items={section.items} ordered={section.ordered} />;
    case 'callout': {
      const tone = section.tone === 'warning' ? '#D97706' : section.tone === 'success' ? '#16A34A' : section.tone === 'premium' ? accent : primary;
      return (
        <div style={{ borderLeft: `4px solid ${tone}`, background: '#eef0f3', padding: '10px 14px', borderRadius: 6, fontSize: 13.5, margin: '12px 0' }}>
          {section.title && <strong>{section.title} </strong>}{section.text}
        </div>
      );
    }
    case 'metrics':
      return (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', margin: '14px 0' }}>
          {section.items.map((m, i) => (
            <div key={i} style={{ flex: 1, minWidth: 120, background: '#eef0f3', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: primary }}>{m.value}</div>
              <div style={{ fontSize: 12 }}>{m.label}</div>
              {m.note && <div style={{ fontSize: 10.5, color: muted }}>{m.note}</div>}
            </div>
          ))}
        </div>
      );
    case 'table': {
      const table = model.tables?.find((t) => t.id === section.tableId);
      if (!table) return null;
      return (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, margin: '14px 0' }}>
          <thead>
            <tr>{table.columns.map((c, i) => <th key={i} style={{ background: primary, color: '#fff', textAlign: 'left', padding: '8px 10px' }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => (
              <tr key={ri} style={{ background: ri % 2 === 1 ? '#eef0f3' : undefined }}>
                {row.map((cell, ci) => <td key={ci} style={{ padding: '7px 10px', borderBottom: '1px solid #e2e5ea' }}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
          {table.totalRow && <tfoot><tr style={{ fontWeight: 700, background: '#e4e8ee' }}>{table.totalRow.map((c, i) => <td key={i} style={{ padding: '7px 10px' }}>{c}</td>)}</tr></tfoot>}
        </table>
      );
    }
    case 'image': {
      const asset = model.assets?.find((a) => a.id === section.assetId);
      return (
        <figure style={{ textAlign: 'center', margin: '16px 0' }}>
          <div style={{ border: '1px dashed #cbd5e1', borderRadius: 8, padding: 24, color: '#94a3b8', fontSize: 12 }}>
            🖼 {asset?.alt ?? section.caption ?? 'Beágyazott kép'} — nyisd meg a fájlt a teljes képért
          </div>
          {section.caption && <figcaption style={{ fontSize: 11, color: muted, fontStyle: 'italic', marginTop: 6 }}>{section.caption}</figcaption>}
        </figure>
      );
    }
    case 'two_column':
      return (
        <div style={{ display: 'flex', gap: 24, margin: '12px 0' }}>
          <div style={{ flex: 1 }}>{section.left.map((s, i) => <SectionView key={i} section={s} model={model} primary={primary} accent={accent} muted={muted} />)}</div>
          <div style={{ flex: 1 }}>{section.right.map((s, i) => <SectionView key={i} section={s} model={model} primary={primary} accent={accent} muted={muted} />)}</div>
        </div>
      );
    case 'divider':
      return <hr style={{ border: 'none', borderTop: '1px solid #e2e5ea', margin: '18px 0' }} />;
    case 'page_break':
      return <div style={{ borderTop: '1px dashed #cbd5e1', margin: '24px 0', textAlign: 'center', fontSize: 10, color: '#94a3b8' }}>— oldaltörés —</div>;
    default:
      return null;
  }
}
