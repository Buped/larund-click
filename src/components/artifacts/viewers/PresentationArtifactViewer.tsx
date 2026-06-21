import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChatArtifactAttachment } from '../../../lib/artifacts/ui';
import { getArtifactSourceModel } from '../../../lib/artifacts/actions';
import { renderSlideInner, STAGE_H, STAGE_W } from '../../../lib/artifacts/presentation/layouts';
import { PRESENTATION_THEMES, getPresentationTheme } from '../../../lib/artifacts/presentation/themes';
import type { DeckSlide, PresentationTheme, PresentationThemeId } from '../../../lib/artifacts/presentation/types';
import { PreviewError, PreviewLoading } from './PdfArtifactViewer';
import { PptxArtifactViewer } from './PptxArtifactViewer';

/** A loose view of whatever deck model shape was stored (new or legacy). */
interface StoredDeck {
  title?: string;
  language?: string;
  themeId?: PresentationThemeId;
  theme?: Partial<PresentationTheme>;
  slides?: DeckSlide[];
}

/** A 1280x720 slide stage scaled to fit its container width (no flash, CSP-safe). */
function ScaledStage({ html, background }: { html: string; background: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / STAGE_W);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', width: '100%', aspectRatio: `${STAGE_W} / ${STAGE_H}`, overflow: 'hidden', background }}>
      <div
        style={{ position: 'absolute', top: 0, left: 0, width: STAGE_W, height: STAGE_H, transformOrigin: 'top left', transform: `scale(${scale})`, visibility: scale ? 'visible' : 'hidden' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function ensureHash(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const s = String(color).trim();
  if (s.startsWith('#')) return s;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return `#${s}`;
  return fallback;
}

/** Resolve the deck theme exactly like the Rust renderer: theme field → themeId → default. */
function resolveTheme(deck: StoredDeck): PresentationTheme {
  const base = deck.themeId && PRESENTATION_THEMES[deck.themeId] ? getPresentationTheme(deck.themeId) : getPresentationTheme('larund-dark');
  const t = (deck.theme ?? {}) as Partial<PresentationTheme>;
  return {
    ...base,
    name: t.name ?? base.name,
    background: ensureHash(t.background, base.background),
    surface: ensureHash(t.surface, base.surface),
    surfaceAlt: ensureHash(t.surfaceAlt, base.surfaceAlt),
    primary: ensureHash(t.primary, base.primary),
    accent: ensureHash(t.accent, base.accent),
    text: ensureHash(t.text, base.text),
    mutedText: ensureHash(t.mutedText, base.mutedText),
    border: ensureHash(t.border, base.border),
    onAccent: ensureHash(t.onAccent, base.onAccent),
  };
}

/** A model is a renderable deck if it carries typed slides — `theme` is optional. */
function asDeck(value: unknown): StoredDeck | null {
  const v = value as StoredDeck | null;
  if (v && Array.isArray(v.slides) && v.slides.length > 0 && v.slides.every((s) => typeof (s as DeckSlide)?.type === 'string')) {
    return v;
  }
  return null;
}

export function PresentationArtifactViewer({ artifact }: { artifact: ChatArtifactAttachment }) {
  const [deck, setDeck] = useState<StoredDeck | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');

  useEffect(() => {
    let disposed = false;
    setState('loading');
    setDeck(null);
    getArtifactSourceModel<unknown>(artifact.artifactId)
      .then((value) => {
        if (disposed) return;
        const d = asDeck(value);
        if (d) {
          setDeck(d);
          setState('ready');
        } else {
          setState('fallback');
        }
      })
      .catch(() => { if (!disposed) setState('fallback'); });
    return () => { disposed = true; };
  }, [artifact.artifactId]);

  if (state === 'loading') return <PreviewLoading label="Building slide preview..." />;
  if (state === 'fallback' || !deck) return <PptxArtifactViewer artifact={artifact} />;

  const slides = deck.slides ?? [];
  const total = slides.length;
  if (total === 0) return <PreviewError message="This presentation has no slides yet. Regenerate the deck." />;

  const theme = resolveTheme(deck);
  const deckTitle = deck.title ?? artifact.title ?? 'Presentation';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: theme.dark ? '#06080c' : '#e9eaee' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', color: 'var(--text-muted)', fontSize: 12, borderBottom: `1px solid ${theme.border}` }}>
        <span style={{ fontWeight: 600, color: theme.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deckTitle}</span>
        <span style={{ flex: '0 0 auto', marginLeft: 12 }}>{total} {total === 1 ? 'slide' : 'slides'} · {theme.name}</span>
      </div>

      {/* All slides, stacked vertically, scrollable. */}
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 18px 8px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          {slides.map((slide, i) => (
            <div key={i} style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '0 2px 7px', color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 600 }}>
                <span style={{ textTransform: 'uppercase', letterSpacing: '.08em' }}>{slideTypeLabel(slide)}</span>
                <span>{i + 1} / {total}</span>
              </div>
              <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border-md)', boxShadow: '0 14px 40px rgba(0,0,0,.4)' }}>
                <ScaledStage html={renderSlideInner(slide, theme, { index: i, total, deckTitle })} background={theme.background} />
              </div>
            </div>
          ))}
        </div>
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11.5, padding: '6px 0 14px' }}>
          Open in PowerPoint / LibreOffice for full-fidelity editing.
        </div>
      </div>
    </div>
  );
}

function slideTypeLabel(slide: DeckSlide): string {
  const map: Record<string, string> = {
    title: 'Címdia', section: 'Szekció', agenda: 'Napirend', bullets: 'Pontok', cards: 'Kártyák',
    timeline: 'Idővonal', process: 'Folyamat', metrics: 'Mutatók', comparison: 'Összevetés',
    quote: 'Idézet', closing: 'Záró',
  };
  return map[slide.type] ?? slide.type;
}
