---
name: artifact-presentation
description: "Create beautiful, designed local PPTX presentations from a themed deck model with a quality gate."
allowed_tools: ["artifact.plan", "artifact.render_pptx", "artifact.verify", "presentation.quality_lint", "artifact.preview", "artifact.open", "artifact.copy_to", "document.read", "ask_user"]
requires_connections: []
risk: "local_write"
trigger: "prezentacio prezentáció diavetites diavetítés slide pptx pitch deck dia"
---

# Artifact Presentation
Use this skill for a PPTX, presentation, slide deck, pitch deck, or a specific slide count.
A presentation is a **visual story, not a document split into pages**. Never emit a
plain/skeleton PPTX with only raw text boxes.

## Process
1. Form a brief (topic, audience, goal, tone) with smart defaults — don't stall with
   many questions. Default tone `premium`, 16:9, 5–8 slides when unspecified.
2. Plan a narrative outline, then a slide storyboard: **one idea per slide**, each with a
   chosen layout type.
3. Build a `PresentationDeckModel` (`kind:"presentation"`): `title`, `themeId`, a resolved
   `theme` (use the presentation themes), and `slides[]` where each slide has a `type`
   (`title`/`section`/`agenda`/`bullets`/`cards`/`timeline`/`process`/`metrics`/
   `comparison`/`quote`/`closing`). Prefer cards/timeline/metrics over bullet walls.
   Use `assembleDeck` / `buildSampleLarundDeck` helpers so the theme + brand resolve.
4. Render with `artifact.render_pptx` (the deck model routes to the themed OOXML renderer
   with backgrounds, shapes, and accent system; Hungarian accents render natively).
5. Verify with `artifact.verify` (slideCount must equal the requested count).
6. Run `presentation.quality_lint` on the deck model. Completion is blocked unless
   `status` is `pass`/`warn`. If it fails (skeleton, wrong count, untitled slides, no
   visual variety, broken accents), fix the model and regenerate.

## Action shapes (exact JSON)
{"action":"artifact.render_pptx","title":"<title>","output_name":"<optional.pptx>","model":{"kind":"presentation","title":"<title>","language":"hu","aspectRatio":"16:9","themeId":"larund-dark","theme":{"background":"#0B0E14","surface":"#171A21","surfaceAlt":"#1F242E","primary":"#EE7E3A","accent":"#F4A261","text":"#F7EFE3","mutedText":"#A6AEBD","border":"#2A2F3A","onAccent":"#0B0E14"},"slides":[{"type":"title","kicker":"<kicker>","title":"<title>","subtitle":"<sub>"},{"type":"cards","title":"<t>","cards":[{"title":"<t>","body":"<b>","icon":"workflow"}]},{"type":"closing","title":"<t>","cta":"<cta>"}]}}
{"action":"presentation.quality_lint","model":{"kind":"presentation"},"expected_slide_count":5}
{"action":"artifact.verify","path":"<path>","expected_kind":"pptx"}

## Rules
- Title slide first; a closing/CTA slide last; every slide carries a title/message.
- Decks over 4 slides need ≥2 visual slides (cards/timeline/metrics/comparison).
- Keep it tight: ≤6 bullets, ≤4 cards, titles under ~90 chars.
- The in-app preview renders the real slides from the deck model — what you build is
  what the user sees, independent of PowerPoint.
