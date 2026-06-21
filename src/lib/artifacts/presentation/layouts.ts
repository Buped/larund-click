// Slide layout library — renders each slide type to inner HTML on a 1280x720
// logical stage. The same renderer powers the in-app React viewer, the stored
// HTML preview file, and the card thumbnail, so what the user sees in-app always
// matches the deck model (independent of PowerPoint fidelity).

import type { DeckCard, DeckMetric, DeckSlide, DeckStep, PresentationTheme, SlideType } from './types';
import { iconSvg, isIconName } from './icons';

export const STAGE_W = 1280;
export const STAGE_H = 720;

/** The layout ids the storyboard can assign, ≥ 8 as required. */
export const LAYOUT_IDS = [
  'title-hero', 'agenda-minimal', 'section-break', 'one-big-idea', 'cards-grid',
  'timeline-horizontal', 'process-steps', 'metric-dashboard', 'comparison-table',
  'quote-slide', 'closing-cta',
] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];

const LAYOUT_FOR_TYPE: Record<SlideType, LayoutId> = {
  title: 'title-hero', agenda: 'agenda-minimal', section: 'section-break',
  bullets: 'one-big-idea', cards: 'cards-grid', timeline: 'timeline-horizontal',
  process: 'process-steps', metrics: 'metric-dashboard', comparison: 'comparison-table',
  quote: 'quote-slide', closing: 'closing-cta',
};

export function layoutForSlide(slide: DeckSlide): LayoutId {
  return LAYOUT_FOR_TYPE[slide.type];
}

export function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function clampChars(s: string, max: number): string {
  const t = String(s ?? '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Coerce possibly-missing model arrays so a partial/legacy slide never crashes. */
function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

interface RenderOpts {
  index: number;
  total: number;
  deckTitle: string;
}

function kicker(text: string | undefined, t: PresentationTheme): string {
  if (!text) return '';
  return `<div style="font:700 17px ${t.fontBody};letter-spacing:.16em;text-transform:uppercase;color:${t.accent};margin-bottom:18px">${esc(clampChars(text, 48))}</div>`;
}

function title(text: string, t: PresentationTheme, size = 52): string {
  return `<div style="font:800 ${size}px/1.08 ${t.fontHeading};color:${t.text};letter-spacing:-.01em">${esc(clampChars(text, 90))}</div>`;
}

function accentBar(t: PresentationTheme): string {
  return `<div style="width:72px;height:5px;border-radius:3px;background:${t.accent};margin:22px 0 28px"></div>`;
}

function footer(o: RenderOpts, t: PresentationTheme): string {
  return `<div style="position:absolute;left:84px;right:84px;bottom:40px;display:flex;justify-content:space-between;align-items:center;font:600 15px ${t.fontBody};color:${t.mutedText};border-top:1px solid ${t.border};padding-top:14px">
    <span>${esc(clampChars(o.deckTitle, 60))}</span><span>${o.index + 1} / ${o.total}</span></div>`;
}

function iconChip(icon: string | undefined, t: PresentationTheme): string {
  const name = icon && isIconName(icon) ? icon : 'spark';
  return `<div style="width:52px;height:52px;border-radius:13px;background:${t.surfaceAlt};display:flex;align-items:center;justify-content:center;margin-bottom:18px">${iconSvg(name, t.accent, 28)}</div>`;
}

function stage(inner: string, t: PresentationTheme, opts: RenderOpts, pad = '78px 84px'): string {
  return `<div style="position:absolute;inset:0;padding:${pad};box-sizing:border-box;font-family:${t.fontBody};color:${t.text};display:flex;flex-direction:column">${inner}${footer(opts, t)}</div>`;
}

/** Render a single slide's inner HTML for the 1280x720 stage. */
export function renderSlideInner(slide: DeckSlide, t: PresentationTheme, opts: RenderOpts): string {
  switch (slide.type) {
    case 'title': {
      const accentGlow = `<div style="position:absolute;right:-120px;top:-120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,${t.primary}33,transparent 70%)"></div>`;
      return `<div style="position:absolute;inset:0;overflow:hidden">${accentGlow}<div style="position:absolute;inset:0;padding:0 96px;display:flex;flex-direction:column;justify-content:center;font-family:${t.fontBody}">
        ${kicker(slide.kicker ?? 'LARUND CLICK', t)}
        <div style="font:800 72px/1.04 ${t.fontHeading};color:${t.text};letter-spacing:-.02em;max-width:980px">${esc(clampChars(slide.title, 80))}</div>
        ${accentBar(t)}
        ${slide.subtitle ? `<div style="font:400 26px/1.4 ${t.fontBody};color:${t.mutedText};max-width:820px">${esc(clampChars(slide.subtitle, 140))}</div>` : ''}
      </div>${footer(opts, t)}</div>`;
    }
    case 'section': {
      const marker = slide.marker ?? String(opts.index + 1).padStart(2, '0');
      return stage(`
        <div style="position:absolute;left:84px;top:64px;font:800 220px ${t.fontHeading};color:${t.primary};opacity:.16">${esc(marker)}</div>
        <div style="margin-top:auto;margin-bottom:120px">
          ${kicker(slide.kicker ?? 'SZEKCIÓ', t)}
          ${title(slide.title, t, 60)}
          ${slide.subtitle ? `<div style="font:400 24px/1.4 ${t.fontBody};color:${t.mutedText};margin-top:18px;max-width:760px">${esc(clampChars(slide.subtitle, 140))}</div>` : ''}
        </div>`, t, opts);
    }
    case 'agenda': {
      const rows = arr<string>(slide.items).slice(0, 6).map((it, i) => `
        <div style="display:flex;align-items:center;gap:20px;padding:14px 0;border-bottom:1px solid ${t.border}">
          <div style="width:40px;height:40px;border-radius:10px;background:${t.accent};color:${t.onAccent};font:800 18px ${t.fontHeading};display:flex;align-items:center;justify-content:center;flex:0 0 auto">${i + 1}</div>
          <div style="font:600 24px ${t.fontBody};color:${t.text}">${esc(clampChars(it, 80))}</div>
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}<div>${rows}</div>`, t, opts);
    }
    case 'bullets': {
      const items = arr<string>(slide.bullets).slice(0, 6).map((b) => `
        <div style="display:flex;gap:16px;align-items:flex-start;margin:16px 0">
          <div style="width:10px;height:10px;border-radius:50%;background:${t.accent};margin-top:11px;flex:0 0 auto"></div>
          <div style="font:500 24px/1.35 ${t.fontBody};color:${t.text}">${esc(clampChars(b, 140))}</div>
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}<div style="flex:1">${items}</div>`, t, opts);
    }
    case 'cards': {
      const cards = arr<DeckCard>(slide.cards).slice(0, 4);
      const cols = cards.length >= 4 ? 4 : cards.length === 1 ? 1 : cards.length === 2 ? 2 : 3;
      const cells = cards.map((c) => `
        <div style="background:${t.surface};border:1px solid ${t.border};border-radius:${t.radius}px;padding:26px;display:flex;flex-direction:column">
          ${iconChip(c.icon, t)}
          <div style="font:700 22px ${t.fontHeading};color:${t.text};margin-bottom:10px">${esc(clampChars(c.title, 48))}</div>
          <div style="font:400 17px/1.45 ${t.fontBody};color:${t.mutedText}">${esc(clampChars(c.body, 150))}</div>
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}
        <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:22px;flex:1;align-content:start">${cells}</div>`, t, opts);
    }
    case 'metrics': {
      const items = arr<DeckMetric>(slide.items).slice(0, 4);
      const cols = Math.min(items.length || 1, 4);
      const cells = items.map((m) => `
        <div style="background:${t.surface};border:1px solid ${t.border};border-radius:${t.radius}px;padding:30px 26px">
          <div style="font:800 56px/1 ${t.fontHeading};color:${t.accent};letter-spacing:-.02em">${esc(clampChars(m.value, 12))}</div>
          <div style="font:600 18px ${t.fontBody};color:${t.text};margin-top:12px">${esc(clampChars(m.label, 48))}</div>
          ${m.note ? `<div style="font:400 15px ${t.fontBody};color:${t.mutedText};margin-top:6px">${esc(clampChars(m.note, 60))}</div>` : ''}
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}
        <div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:22px;flex:1;align-content:center">${cells}</div>`, t, opts);
    }
    case 'timeline': {
      const steps = arr<DeckStep>(slide.steps).slice(0, 5);
      const cells = steps.map((s, i) => `
        <div style="flex:1;position:relative;padding-top:42px">
          <div style="position:absolute;top:0;left:0;width:22px;height:22px;border-radius:50%;background:${t.accent};border:4px solid ${t.background};box-shadow:0 0 0 2px ${t.accent}"></div>
          ${i < steps.length - 1 ? `<div style="position:absolute;top:10px;left:22px;right:-8px;height:3px;background:${t.border}"></div>` : ''}
          ${s.label ? `<div style="font:700 14px ${t.fontBody};letter-spacing:.1em;text-transform:uppercase;color:${t.accent};margin-bottom:6px">${esc(clampChars(s.label, 18))}</div>` : ''}
          <div style="font:700 20px ${t.fontHeading};color:${t.text};margin-bottom:8px">${esc(clampChars(s.title, 36))}</div>
          <div style="font:400 15px/1.4 ${t.fontBody};color:${t.mutedText};padding-right:14px">${esc(clampChars(s.body, 110))}</div>
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}
        <div style="display:flex;gap:8px;flex:1;align-items:flex-start;margin-top:18px">${cells}</div>`, t, opts);
    }
    case 'process': {
      const steps = arr<DeckStep>(slide.steps).slice(0, 5);
      const cells = steps.map((s, i) => `
        <div style="display:flex;align-items:center;gap:14px">
          <div style="background:${t.surface};border:1px solid ${t.border};border-radius:${t.radius}px;padding:22px;flex:1;min-width:0">
            <div style="font:800 16px ${t.fontHeading};color:${t.accent}">${String(i + 1).padStart(2, '0')}</div>
            <div style="font:700 19px ${t.fontHeading};color:${t.text};margin:8px 0">${esc(clampChars(s.title, 32))}</div>
            <div style="font:400 15px/1.4 ${t.fontBody};color:${t.mutedText}">${esc(clampChars(s.body, 100))}</div>
          </div>
          ${i < steps.length - 1 ? `<div style="font:700 30px ${t.fontHeading};color:${t.accent};flex:0 0 auto">→</div>` : ''}
        </div>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}
        <div style="display:flex;gap:10px;flex:1;align-items:center">${cells}</div>`, t, opts);
    }
    case 'comparison': {
      const cols = arr<string>(slide.columns).slice(0, 4);
      const head = cols.map((c, i) => `<th style="text-align:${i === 0 ? 'left' : 'center'};padding:16px 18px;font:700 19px ${t.fontHeading};color:${i === 0 ? t.text : t.onAccent};background:${i === 0 ? 'transparent' : t.accent};border-radius:${i === 0 ? 0 : '10px 10px 0 0'}">${esc(clampChars(c, 28))}</th>`).join('');
      const body = arr<string[]>(slide.rows).slice(0, 6).map((row, ri) => `<tr style="background:${ri % 2 ? t.surface : 'transparent'}">${arr<string>(row).slice(0, cols.length).map((cell, ci) => `<td style="text-align:${ci === 0 ? 'left' : 'center'};padding:14px 18px;font:${ci === 0 ? 600 : 400} 18px ${t.fontBody};color:${ci === 0 ? t.text : t.mutedText};border-bottom:1px solid ${t.border}">${esc(clampChars(cell, 40))}</td>`).join('')}</tr>`).join('');
      return stage(`${kicker(slide.kicker, t)}${title(slide.title, t)}${accentBar(t)}
        <table style="width:100%;border-collapse:collapse;margin-top:10px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`, t, opts);
    }
    case 'quote': {
      return stage(`<div style="flex:1;display:flex;flex-direction:column;justify-content:center;max-width:980px">
        <div style="font:800 120px/1 ${t.fontHeading};color:${t.accent};height:60px">“</div>
        <div style="font:600 40px/1.3 ${t.fontHeading};color:${t.text};letter-spacing:-.01em">${esc(clampChars(slide.quote, 220))}</div>
        ${slide.author ? `<div style="font:600 22px ${t.fontBody};color:${t.mutedText};margin-top:28px">— ${esc(clampChars(slide.author, 60))}</div>` : ''}
      </div>`, t, opts);
    }
    case 'closing': {
      const glow = `<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:760px;height:760px;border-radius:50%;background:radial-gradient(circle,${t.primary}26,transparent 68%)"></div>`;
      return `<div style="position:absolute;inset:0;overflow:hidden;font-family:${t.fontBody}">${glow}
        <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 96px">
          ${kicker(slide.kicker, t)}
          <div style="font:800 64px/1.06 ${t.fontHeading};color:${t.text};letter-spacing:-.02em;max-width:980px">${esc(clampChars(slide.title, 80))}</div>
          ${slide.subtitle ? `<div style="font:400 24px/1.4 ${t.fontBody};color:${t.mutedText};margin-top:20px;max-width:760px">${esc(clampChars(slide.subtitle, 150))}</div>` : ''}
          ${slide.cta ? `<div style="margin-top:34px;background:${t.accent};color:${t.onAccent};font:700 20px ${t.fontHeading};padding:16px 34px;border-radius:999px">${esc(clampChars(slide.cta, 40))}</div>` : ''}
        </div>${footer(opts, t)}</div>`;
    }
    default:
      return stage(title('', t), t, opts);
  }
}
