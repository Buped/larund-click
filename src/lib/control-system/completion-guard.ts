// Completion guard. The loop routes every `task.complete` through here *before*
// closing the run. If the requested outcome is not verified by the evidence, the
// completion is rejected and the model is told to keep going. This is enforced in
// code, not just in the prompt, so a too-eager model cannot shortcut it.

import type { ActiveTaskState, RecentAction } from '../agent-state/types';
import { verifyCompletion } from './goal-verifier';
import { evidenceFromRecentActions, isExplicitWebLookup } from '../web-search/quality';

export interface GuardResult {
  ok: boolean;
  reason: string;
  nextStepHint: string;
}

const CONTROL_ACTIONS = new Set(['task.complete', 'ask_user', 'approval.request', 'skill.run']);
const READBACK_ACTIONS = new Set([
  'file.exists', 'file.list', 'file.tree', 'file.read', 'file.metadata',
  'sheet.read', 'sheet.to_json', 'sheet.profile',
  'document.read', 'document.read_many', 'folder.scan', 'folder.read_relevant', 'doc.read',
  'artifact.verify', 'artifact.design_lint', 'presentation.quality_lint', 'artifact.preview', 'artifact.list', 'artifact.pdf_extract_text',
  'artifact.pdf_metadata', 'artifact.pdf_page_count',
  'browser.read', 'browser.get_state', 'browser.assert_text', 'browser.assert_url', 'browser.extract_table',
  'web.search', 'web.batch_search', 'web.extract_page', 'web.extract_contact_info', 'web.verify_source',
  'connection.call', 'email.compose',
]);

function looksLikeArtifactRequest(text: string): boolean {
  return /\b(pdf|docx|pptx|word|prezent[aá]ci[oó]|diavet[ií]t[eé]s|deck|slide|riport|proposal|aj[aá]nlat|sz[aá]mla|szerz[oő]d[eé]s|one[- ]pager|let[oö]lthet[oő] f[aá]jl)\b/i.test(text);
}

function artifactCompletionPrecheck(state: ActiveTaskState, recent: RecentAction[]): GuardResult | null {
  // Email tasks are handled by emailCompletionPrecheck/verifyEmail; never treat
  // them as artifact-generation (the email expectedOutcome mentions file formats).
  if (state.intent === 'email') return null;
  if (!looksLikeArtifactRequest(`${state.originalUserGoal}\n${state.currentGoal}\n${state.expectedOutcome ?? ''}`)) {
    return null;
  }
  // The legacy local-doc (`doc.write_*`) and Google Docs flows have their own
  // read-back verification. Only enforce the artifact-pipeline gate when the run
  // actually went through the `artifact.*` pipeline (or did no document work at
  // all yet); otherwise defer to the normal verifier.
  const usedArtifactPipeline = recent.some((a) => a.action.startsWith('artifact.'));
  const usedLegacyDocPath = recent.some(
    (a) =>
      a.success &&
      (a.action === 'doc.write_docx' ||
        a.action === 'doc.write_txt' ||
        (a.action === 'connection.call' && /google\.docs\./.test(a.argsSummary ?? ''))),
  );
  if (usedLegacyDocPath && !usedArtifactPipeline) {
    return null;
  }
  const rendered = recent.some((a) => a.success && ['artifact.render_pdf', 'artifact.render_docx', 'artifact.render_pptx', 'artifact.convert'].includes(a.action));
  if (!rendered) {
    return {
      ok: false,
      reason: 'The user asked for a generated document/artifact, but no artifact render action succeeded.',
      nextStepHint: 'Build a structured artifact model, render it with artifact.render_pdf/docx/pptx, then verify the output.',
    };
  }
  const verified = recent.some((a) => a.success && a.action === 'artifact.verify' && /"exists"\s*:\s*true/.test(a.output ?? '') && /"readable"\s*:\s*true/.test(a.output ?? ''));
  if (!verified) {
    return {
      ok: false,
      reason: 'An artifact was rendered, but there is no successful artifact.verify evidence with exists/readable true.',
      nextStepHint: 'Run artifact.verify on the generated output file, including expected text or slide/page expectations when relevant.',
    };
  }
  // Designed-by-default gate. Presentations use presentation.quality_lint (slide
  // story / visual variety / accents); other documents use artifact.design_lint
  // (accents, structure, totals, embedded font).
  const goalText = `${state.originalUserGoal}\n${state.currentGoal}\n${state.expectedOutcome ?? ''}`;
  const isPresentation = /\b(pptx|prezent[aá]ci[oó]|diavet[ií]t[eé]s|deck|slide|di[aá]s|dia)\b/i.test(goalText);
  const lintAction = isPresentation ? 'presentation.quality_lint' : 'artifact.design_lint';
  const lintFailed = recent.some((a) => a.success && a.action === lintAction && /"status"\s*:\s*"fail"/.test(a.output ?? ''));
  if (lintFailed) {
    return {
      ok: false,
      reason: `${lintAction} reported status "fail" — the artifact has design/content defects (e.g. broken accents, skeleton/empty layout, wrong slide count, missing totals).`,
      nextStepHint: isPresentation
        ? 'Fix the failing checks (real title/closing slides, visual variety, correct slide count, accents) and regenerate, then re-run presentation.quality_lint until status is pass/warn.'
        : 'Fix the failing checks (template, embedded-font PDF, correct accents, totals/footer) and regenerate, then re-run artifact.design_lint until status is pass/warn.',
    };
  }
  const lintOk = recent.some((a) => a.success && a.action === lintAction && /"status"\s*:\s*"(pass|warn)"/.test(a.output ?? ''));
  if (!lintOk) {
    return {
      ok: false,
      reason: `The artifact was rendered and verified, but no passing ${lintAction} quality gate is recorded.`,
      nextStepHint: isPresentation
        ? 'Run presentation.quality_lint on the deck model and ensure status is pass or warn before task.complete.'
        : 'Run artifact.design_lint on the output file (pass the document model) and ensure status is pass or warn before task.complete.',
    };
  }
  const slideMatch = `${state.originalUserGoal} ${state.currentGoal}`.match(/\b(\d+)\s*(di[aá]s|slides?|slide|dia)\b/i);
  if (slideMatch) {
    const expected = Number(slideMatch[1]);
    const matchingSlides = recent.some((a) => a.success && a.action === 'artifact.verify' && new RegExp(`"slideCount"\\s*:\\s*${expected}`).test(a.output ?? ''));
    if (!matchingSlides) {
      return {
        ok: false,
        reason: `The presentation request expected ${expected} slides, but verification does not prove that slide count.`,
        nextStepHint: `Regenerate or verify the PPTX so artifact.verify reports slideCount = ${expected}.`,
      };
    }
  }
  return null;
}

// Cross-cutting email guard. Even if preflight mis-classified the task (e.g. the
// recipient's "@gmail.com" routed it to the browser intent), an email request must
// never be completed with only a local TXT/DOCX file. A successful email.compose
// (the editable card — connected or not) or real Gmail draft/send evidence is the
// deliverable; the card lets the user connect + send with one click.
function emailCompletionPrecheck(state: ActiveTaskState, recent: RecentAction[]): GuardResult | null {
  const goal = `${state.originalUserGoal}\n${state.currentGoal}\n${state.expectedOutcome ?? ''}`;
  const mentionsEmail = /\b(e-?mail|emailt|emailek|email|levelet|levél|level|piszkozat|draftot|draft|gmail)\b/i.test(goal);
  const wantsCompose = /\b(küldj|küldd|küld|elküld|írj|írd|fogalmazz|válaszolj|forward|továbbít|send|compose|reply|draft|piszkozat)\b/i.test(goal);
  if (!mentionsEmail || !wantsCompose) return null;

  const composed = recent.some(
    (a) =>
      (a.action === 'email.compose' && a.success) ||
      (a.action === 'connection.call' && a.success && /google\.gmail\.(create_draft|send|update_draft)/i.test(a.argsSummary ?? '')),
  );
  if (composed) return null; // the email card / provider evidence exists → defer to the verifier

  const onlyLocal = recent.some((a) => a.success && ['doc.write_txt', 'doc.write_docx', 'file.write'].includes(a.action));
  return {
    ok: false,
    reason: onlyLocal
      ? 'An email request was answered with only a local TXT/DOCX file — that is not an email and the composer card was never surfaced.'
      : 'An email request has no email composer card yet.',
    nextStepHint:
      'Call email.compose {to, subject, body} to surface the editable, formatted email card. If Gmail is not connected the card has a one-click Connect button — never finish an email task with a local file.',
  };
}

function activeSkillPrecheck(state: ActiveTaskState, recent: RecentAction[]): GuardResult | null {
  const active = state.activeSkills ?? [];
  if (!active.length) return null;
  const missing = active.flatMap((skill) => skill.missingRequirements);
  if (missing.length) {
    return {
      ok: false,
      reason: `Active skill requirements are missing: ${missing.map((m) => `${m.kind}:${m.id}`).join(', ')}.`,
      nextStepHint: 'Resolve the missing requirement or ask the user before changing target surface.',
    };
  }
  const realWork = recent.some((a) => a.success && !CONTROL_ACTIONS.has(a.action));
  if (!realWork) {
    return {
      ok: false,
      reason: 'A skill was loaded, but no task work has run yet.',
      nextStepHint: 'Follow the active skill workflow with structured tools, then verify.',
    };
  }
  const requiresReadback = active.some((skill) => skill.risk !== 'read_only' || skill.verificationChecklist.length > 0);
  const hasReadback = recent.some((a) => a.success && READBACK_ACTIONS.has(a.action));
  if (requiresReadback && !hasReadback) {
    return {
      ok: false,
      reason: 'The active skill verification checklist has no read-back evidence.',
      nextStepHint: 'Run the appropriate read-back/assertion tool from the active skill before task.complete.',
    };
  }
  return null;
}

function webLookupPrecheck(state: ActiveTaskState, recent: RecentAction[]): GuardResult | null {
  const goal = `${state.originalUserGoal}\n${state.currentGoal}\n${state.expectedOutcome ?? ''}`;
  if (state.intent !== 'web_lookup' || !isExplicitWebLookup(goal)) return null;

  const evidence = evidenceFromRecentActions(recent);
  if (evidence.mode !== 'server_side' && evidence.mode !== 'provider_native') {
    return {
      ok: false,
      reason: 'The user asked for internet search, but no provider-native or server-side web search evidence succeeded.',
      nextStepHint: 'Use web.search or web.batch_search. Do not fall back to browser.open for ordinary search; if no search provider is configured, report blocked_missing_web_search_capability.',
    };
  }
  if (evidence.usedSearchEnginePage) {
    return {
      ok: false,
      reason: 'A browser search-engine result page was used as search evidence.',
      nextStepHint: 'Use the programmatic web.search/web.batch_search adapter instead of Google/Bing/DuckDuckGo pages.',
    };
  }
  if (evidence.sources.length === 0) {
    return {
      ok: false,
      reason: 'The web search action did not return any clickable source URLs.',
      nextStepHint: 'Run web.search again with a better query or configure a search provider; do not complete without sources.',
    };
  }
  if (evidence.quality === 'failed') {
    return {
      ok: false,
      reason: `Web search evidence failed quality checks: ${evidence.warnings.join('; ')}`,
      nextStepHint: 'Collect valid web.search evidence with source URLs before completing.',
    };
  }
  return null;
}

function professionalSpreadsheetPrecheck(state: ActiveTaskState, recent: RecentAction[]): GuardResult | null {
  const goal = `${state.originalUserGoal}\n${state.currentGoal}\n${state.expectedOutcome ?? ''}`;
  const userRequest = `${state.originalUserGoal}\n${state.currentGoal}`;
  const plainGoal = userRequest.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const robustLocalSpreadsheet =
    state.intent === 'spreadsheet_local' || /\b(excel|xlsx|spreadsheet)\b|munkafuzet\w*|tablazat\w*/.test(plainGoal);
  const robustProfessional =
    /riport\w*|jelentes\w*|teljesitmeny\w*|performance|dashboard|osszesito\w*|minimum\s+\d+|legalabb\s+\d+|meg minden|kitart\w*|reszletes\w*|kpi/.test(plainGoal);
  const robustRaw = /\b(csv|nyers adat|raw data only|plain export|egyszeru)\b/.test(plainGoal);
  const robustCloud = state.intent === 'spreadsheet_cloud' || /google\s*(sheet|sheets)|google\s*tablazat\w*/.test(plainGoal);
  if (robustCloud) return null;
  if (robustLocalSpreadsheet && robustProfessional && !robustRaw && !robustCloud) {
    const wroteSheet = recent.some((a) => a.success && ['sheet.write', 'sheet.append'].includes(a.action));
    if (!wroteSheet) return null;
    const missing = [
      recent.some((a) => a.success && a.action === 'sheet.format_range') ? null : 'sheet.format_range',
      recent.some((a) => a.success && a.action === 'sheet.add_table') ? null : 'sheet.add_table',
      recent.some((a) => a.success && a.action === 'sheet.add_chart') ? null : 'sheet.add_chart',
    ].filter((name): name is string => Boolean(name));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `The user asked for a professional Excel report, but the workbook is missing visible report styling/actions: ${missing.join(', ')}.`,
        nextStepHint:
          'Continue the workbook: apply visible header/body styling with sheet.format_range, add a native styled table with sheet.add_table, add a relevant chart with sheet.add_chart, then read it back before task.complete.',
      };
    }
    return null;
  }
  if (state.intent === 'spreadsheet_cloud' || /google\s*(sheet|sheets)|google\s*t[aá]bl[aá]zat\w*/i.test(goal)) return null;
  const asksLocalSpreadsheet = state.intent === 'spreadsheet_local' || /\b(excel|xlsx|spreadsheet)\b|munkaf[uü]zet\w*|t[aá]bl[aá]zat\w*/i.test(goal);
  if (!asksLocalSpreadsheet) return null;
  if (/\b(csv|nyers adat|raw data only|plain export|egyszer[uű])\b/i.test(goal)) return null;

  const wantsProfessionalReport = /riport\w*|jelent[eé]s\w*|teljes[ií]tm[eé]ny\w*|performance|dashboard|[oö]sszes[ií]t[oő]\w*|minimum\s+\d+|legal[aá]bb\s+\d+|meg minden|kit[aá]rt\w*|r[eé]szletes\w*|kpi/i.test(goal);
  if (!wantsProfessionalReport) return null;

  const wroteSheet = recent.some((a) => a.success && ['sheet.write', 'sheet.append'].includes(a.action));
  if (!wroteSheet) return null;

  const formatted = recent.some((a) => a.success && a.action === 'sheet.format_range');
  const tabled = recent.some((a) => a.success && a.action === 'sheet.add_table');
  const charted = recent.some((a) => a.success && a.action === 'sheet.add_chart');

  const missing: string[] = [];
  if (!formatted) missing.push('sheet.format_range');
  if (!tabled) missing.push('sheet.add_table');
  if (!charted) missing.push('sheet.add_chart');
  if (missing.length === 0) return null;

  return {
    ok: false,
    reason: `The user asked for a professional Excel report, but the workbook is missing visible report styling/actions: ${missing.join(', ')}.`,
    nextStepHint:
      'Continue the workbook: apply visible header/body styling with sheet.format_range, add a native styled table with sheet.add_table, add a relevant chart with sheet.add_chart, then read it back before task.complete.',
  };
}

export function verifyBeforeComplete(
  state: ActiveTaskState,
  recent: RecentAction[],
): GuardResult {
  const skillCheck = activeSkillPrecheck(state, recent);
  if (skillCheck) return skillCheck;

  const emailCheck = emailCompletionPrecheck(state, recent);
  if (emailCheck) return emailCheck;

  const artifactCheck = artifactCompletionPrecheck(state, recent);
  if (artifactCheck) return artifactCheck;

  const webLookupCheck = webLookupPrecheck(state, recent);
  if (webLookupCheck) return webLookupCheck;

  // If the user previously corrected a false completion, a prior task.complete is
  // not acceptable as evidence; the verifier already ignores control actions, but
  // we additionally require fresh successful work *after* the last correction.
  if (state.userCorrections.length > 0) {
    const hasFreshWork = recent.some(
      (a) => a.success && !['task.complete', 'ask_user', 'approval.request'].includes(a.action),
    );
    if (!hasFreshWork) {
      return {
        ok: false,
        reason: 'You were corrected; the previous completion was wrong. Redo the work — do not just re-complete.',
        nextStepHint: 'Take the corrective action on the real target, then verify.',
      };
    }
  }

  const v = verifyCompletion(state, recent);
  if (!v.ok) return { ok: v.ok, reason: v.reason, nextStepHint: v.nextStepHint };

  const spreadsheetCheck = professionalSpreadsheetPrecheck(state, recent);
  if (spreadsheetCheck) return spreadsheetCheck;

  return { ok: v.ok, reason: v.reason, nextStepHint: v.nextStepHint };
}

/** Message fed back to the model when a completion is rejected. */
export function rejectionMessage(result: GuardResult): string {
  return `Completion rejected: ${result.reason}\nRequired next step: ${result.nextStepHint}\nContinue using structured tools; do not claim success until verified.`;
}
