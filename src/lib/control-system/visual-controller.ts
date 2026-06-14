import { invoke } from '@tauri-apps/api/core';
import type { ScreenObservation, TargetCandidate, VisualActionResult, VisualClickIntent, VisualTypeIntent } from './types';
import { observeScreen, captureScreenRegion } from './observe';
import { buildVisualMap, renderGridOverlay } from './visual-map';
import { cropAroundCell, makeGrid } from './grid';
import { groundGridWithQwen, groundingToCandidate } from './qwen-grounder';
import { rankLocalCandidates } from './target-resolver';
import { makeVerifiedMouseTarget, executeVerifiedClick } from './mouse-kernel';
import { verifyVisualAction } from './verifier';
import { makeRunId, stepDir, writeDebug, writeJson } from './debug';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function writeObservation(dir: string, name: string, obs: ScreenObservation): Promise<void> {
  const { capture, ...rest } = obs;
  await writeJson(`${dir}/${name}-observation.json`, { ...rest, capture: { ...capture, base64: `<${capture.base64.length} chars>` } });
  await writeDebug(`${dir}/${name}-screenshot.b64`, capture.base64);
}

async function qwenGridCandidate(before: ScreenObservation, intent: VisualClickIntent, dir: string): Promise<TargetCandidate | null> {
  const visualMap = await buildVisualMap(before.capture, 40);
  await writeDebug(`${dir}/coarse-overlay.b64`, visualMap.coarseOverlayBase64);
  await writeJson(`${dir}/coarse-grid.json`, visualMap.coarseGrid);
  const coarse = await groundGridWithQwen({
    imageBase64: visualMap.coarseOverlayBase64,
    capture: before.capture,
    grid: visualMap.coarseGrid,
    target: intent.target,
    expected: intent.expected,
    userId: intent.userId,
    addCost: intent.addCost,
    stage: 'coarse',
  });
  await writeJson(`${dir}/coarse-grounding.json`, coarse);
  if (!coarse.targetFound || !coarse.cell) return null;

  const fineRegion = cropAroundCell(coarse.cell, { width: before.capture.width, height: before.capture.height }, 240);
  const fineCapture = await captureScreenRegion(fineRegion, before.capture.monitorId);
  const fineGrid = makeGrid(fineRegion, coarse.confidence < 0.82 ? 5 : 10);
  const fineOverlay = await renderGridOverlay(fineCapture, fineGrid);
  await writeDebug(`${dir}/fine-overlay.b64`, fineOverlay);
  await writeJson(`${dir}/fine-grid.json`, fineGrid);
  const fine = await groundGridWithQwen({
    imageBase64: fineOverlay,
    capture: fineCapture,
    grid: fineGrid,
    target: intent.target,
    expected: intent.expected,
    userId: intent.userId,
    addCost: intent.addCost,
    stage: fineGrid.cellSize <= 5 ? 'ultra' : 'fine',
  });
  await writeJson(`${dir}/fine-grounding.json`, fine);
  if (!fine.targetFound || !fine.cell) return groundingToCandidate(coarse.cell, coarse, intent.target);
  const candidate = groundingToCandidate(fine.cell, fine, intent.target);
  candidate.metadata = { ...candidate.metadata, coarseCell: coarse.cell.id, fineCell: fine.cell.id };
  return candidate;
}

async function resolveCandidate(before: ScreenObservation, intent: VisualClickIntent, dir: string): Promise<TargetCandidate | null> {
  const local = rankLocalCandidates(before, intent);
  await writeJson(`${dir}/local-candidates.json`, local);
  if (local[0]?.confidence >= 0.82) return local[0];
  const qwen = await qwenGridCandidate(before, intent, dir);
  if (qwen?.confidence && qwen.confidence >= 0.75) return qwen;
  return local[0]?.confidence >= 0.75 ? local[0] : null;
}

export async function clickIntent(intent: VisualClickIntent): Promise<VisualActionResult> {
  const runId = makeRunId();
  const maxAttempts = Math.max(1, Math.min(4, intent.maxAttempts ?? 3));
  let lastError = 'no_grounding_found';
  let lastBefore: ScreenObservation | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const dir = stepDir(runId, attempt);
    const before = await observeScreen();
    lastBefore = before;
    await writeObservation(dir, 'before', before);
    const candidate = await resolveCandidate(before, intent, dir);
    if (!candidate) {
      lastError = 'no_grounding_found';
      await writeJson(`${dir}/result.json`, { success: false, error: lastError });
      continue;
    }

    try {
      const target = makeVerifiedMouseTarget(before, candidate, intent, {
        coarseCell: String(candidate.metadata?.coarseCell ?? candidate.metadata?.cell ?? ''),
        fineCell: String(candidate.metadata?.fineCell ?? ''),
      });
      await writeJson(`${dir}/selected-target.json`, target);
      await executeVerifiedClick(target);
      await sleep(900);
      const after = await observeScreen();
      await writeObservation(dir, 'after', after);
      const verification = verifyVisualAction(before, after, intent);
      await writeJson(`${dir}/verification.json`, verification);
      if (verification.verified) {
        return { success: true, before, after, target, verification, attempts: attempt, debugDir: `~/.larund-click/control-system/${runId}` };
      }
      lastError = verification.reason;
    } catch (err) {
      lastError = String(err instanceof Error ? err.message : err);
      await writeJson(`${dir}/result.json`, { success: false, error: lastError, candidate });
    }
  }

  return { success: false, before: lastBefore, attempts: maxAttempts, error: lastError, debugDir: `~/.larund-click/control-system/${runId}` };
}

export async function typeIntent(intent: VisualTypeIntent): Promise<VisualActionResult> {
  const click = await clickIntent(intent);
  if (!click.success) return click;
  await invoke('type_text', { text: intent.text });
  await sleep(500);
  const afterTyping = await observeScreen();
  const verification = click.before ? verifyVisualAction(click.before, afterTyping, intent) : undefined;
  return {
    ...click,
    after: afterTyping,
    verification,
    success: verification?.verified ?? click.success,
    error: verification?.verified === false ? verification.reason : undefined,
  };
}
