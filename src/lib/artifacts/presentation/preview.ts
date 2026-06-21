// HTML preview renderer — turns a deck model into a real, themed, scrollable
// slide preview (not a skeleton). Used to write the stored preview.html and as
// the single source of truth for the in-app React viewer + card thumbnail.

import type { DeckSlide, PresentationDeckModel, PresentationTheme } from './types';
import { renderSlideInner, STAGE_H, STAGE_W } from './layouts';

/** A self-contained 1280x720 themed stage for one slide (no outer scaling). */
export function renderSlideStage(slide: DeckSlide, theme: PresentationTheme, index: number, total: number, deckTitle: string): string {
  const inner = renderSlideInner(slide, theme, { index, total, deckTitle });
  return `<div class="stage" style="position:relative;width:${STAGE_W}px;height:${STAGE_H}px;background:${theme.background};overflow:hidden">${inner}</div>`;
}

const SCALE_SCRIPT = `<script>
function scaleStages(){document.querySelectorAll('.slide-frame').forEach(function(f){var s=f.querySelector('.stage');if(!s)return;var k=f.clientWidth/${STAGE_W};s.style.transformOrigin='top left';s.style.transform='scale('+k+')';f.style.height=(${STAGE_H}*k)+'px';});}
window.addEventListener('resize',scaleStages);window.addEventListener('load',scaleStages);scaleStages();
</script>`;

/** Full preview document with every slide, responsive to width. */
export function renderPresentationHtml(model: PresentationDeckModel): string {
  const t = model.theme;
  const total = model.slides.length;
  const frames = model.slides
    .map((slide, i) => `<div class="slide-frame" style="position:relative;width:100%;overflow:hidden;border-radius:14px;border:1px solid ${t.border};box-shadow:0 18px 50px rgba(0,0,0,.35);margin:0 auto 26px;max-width:1100px">${renderSlideStage(slide, t, i, total, model.title)}</div>`)
    .join('\n');
  return `<!doctype html><html lang="${model.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(model.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0}body{background:${t.dark ? '#06080c' : '#e9eaee'};padding:28px 20px;font-family:${t.fontBody}}
.deck-meta{max-width:1100px;margin:0 auto 22px;color:${t.dark ? '#9aa3b2' : '#5b6370'};font:600 13px ${t.fontBody};display:flex;justify-content:space-between}
</style></head><body>
<div class="deck-meta"><span>${escapeAttr(model.title)}</span><span>${total} ${total === 1 ? 'slide' : 'slides'} · ${escapeAttr(model.theme.name)}</span></div>
${frames}
${SCALE_SCRIPT}
</body></html>`;
}

function escapeAttr(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
