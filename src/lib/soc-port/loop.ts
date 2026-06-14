import { getSocPortConfig } from './config';
import { createSocPortDebugWriter } from './debug';
import { executeSocPortOperation } from './executor';
import { buildSocLabels } from './label';
import { callSocPortModel } from './model';
import { normalizeSocText, readSocOcr } from './ocr';
import { takeSocScreenshot } from './screenshot';
import type { SocPortActionLog, SocPortLabelMap, SocPortTurnLog } from './types';

export interface SocPortLoopResult {
  success: boolean;
  summary: string;
  history: SocPortTurnLog[];
  debugDir: string;
  screenshot?: { base64: string; width: number; height: number };
  error?: string;
}

export interface SocPortCallbacks {
  addCost?: (usd: number) => void;
  onStep?: (step: {
    type: 'tool_call' | 'tool_result' | 'thinking' | 'complete' | 'error';
    tool?: string;
    input?: string;
    output?: string;
    error?: string;
    screenshotBase64?: string;
    details?: Record<string, unknown>;
  }) => void;
}

export async function runSocPortLoop(
  objective: string,
  userId: string,
  callbacks: SocPortCallbacks = {},
): Promise<SocPortLoopResult> {
  const config = getSocPortConfig();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const history: SocPortTurnLog[] = [];
  const expectedText = extractExpectedText(objective);

  for (let step = 1; step <= config.maxSteps; step++) {
    const debug = createSocPortDebugWriter(runId, step);
    const screenshot = await takeSocScreenshot();
    const ocr = config.mode === 'standard' ? [] : await readSocOcr(screenshot);
    let labels: SocPortLabelMap | undefined;
    if (config.mode === 'labeled') {
      labels = await buildSocLabels(screenshot);
      await debug.writeBase64('label-overlay.jpg', labels.labeledImageBase64);
      await debug.writeText('labels.json', JSON.stringify(labels.labelCoordinates, null, 2));
    }

    await debug.writeBase64('raw-screenshot.jpg', screenshot.base64);
    await debug.writeText('ocr.json', JSON.stringify(ocr, null, 2));
    await debug.writeText('turn-context.json', JSON.stringify({
      objective,
      mode: config.mode,
      step,
      expectedText,
      previousActions: history.flatMap((turn) => turn.actions),
    }, null, 2));

    callbacks.onStep?.({
      type: 'thinking',
      output: `SOC visual observe: screenshot ${screenshot.width}x${screenshot.height}, OCR ${ocr.length}, mode ${config.mode}`,
      screenshotBase64: screenshot.base64,
      details: { mode: 'soc_visual', socPortMode: config.mode, ocrCount: ocr.length, labelCount: labels ? Object.keys(labels.labelCoordinates).length : 0, debugDir: debug.dir },
    });

    let modelResult;
    try {
      modelResult = await callSocPortModel({
        mode: config.mode,
        objective,
        screenshot,
        labeledScreenshotBase64: labels?.labeledImageBase64,
        ocr,
        labels: labels?.labelCoordinates,
        history,
        model: config.model,
        fallbackModel: config.fallbackModel,
        userId,
      });
      callbacks.addCost?.(modelResult.usage.costUsd);
      await debug.writeText('model-output.json', modelResult.raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await debug.writeText('model-error.txt', message);
      return { success: false, summary: '', history, debugDir: `~/.larund-click/soc-port/${runId}`, screenshot, error: message };
    }

    const actions: SocPortActionLog[] = [];
    for (const operation of modelResult.operations) {
      callbacks.onStep?.({
        type: 'tool_call',
        tool: `soc.${operation.operation}`,
        input: JSON.stringify(operation, null, 2),
        screenshotBase64: labels?.labeledImageBase64 ?? screenshot.base64,
        details: { mode: 'soc_visual', socPortMode: config.mode, model: modelResult.model, debugDir: debug.dir },
      });

      const action = await executeSocPortOperation({ operation, screenshot, ocr, labels });
      actions.push(action);
      await debug.writeText(`execution-log-${actions.length}.json`, JSON.stringify(action, null, 2));
      await debug.writeText('execution-log.json', JSON.stringify(actions, null, 2));

      if (!action.success) {
        const afterFailure = await takeSocScreenshot();
        await debug.writeBase64('after-screenshot.jpg', afterFailure.base64);
        history.push({ step, screenshot, after: afterFailure, ocr, labels, model: modelResult.model, rawModelOutput: modelResult.raw, actions });
        callbacks.onStep?.({ type: 'error', tool: `soc.${operation.operation}`, error: action.error, output: action.output, screenshotBase64: afterFailure.base64, details: { ...action, debugDir: debug.dir } });
        break;
      }

      callbacks.onStep?.({
        type: 'tool_result',
        tool: `soc.${operation.operation}`,
        output: action.output,
        details: { ...action, debugDir: debug.dir },
      });

      if (operation.operation === 'done') {
        const afterDone = await takeSocScreenshot();
        const afterOcr = expectedText ? await readSocOcr(afterDone) : [];
        if (expectedText && !ocrContainsExpected(afterOcr, expectedText)) {
          const error = 'done_rejected_expected_text_not_visible';
          await debug.writeText('done-rejected.json', JSON.stringify({ expectedText, afterOcr }, null, 2));
          await debug.writeBase64('after-screenshot.jpg', afterDone.base64);
          history.push({ step, screenshot, after: afterDone, ocr, labels, model: modelResult.model, rawModelOutput: modelResult.raw, actions });
          callbacks.onStep?.({ type: 'error', tool: 'soc.done', error, screenshotBase64: afterDone.base64, details: { expectedText, debugDir: debug.dir } });
          break;
        }
        await debug.writeBase64('after-screenshot.jpg', afterDone.base64);
        history.push({ step, screenshot, after: afterDone, ocr, labels, model: modelResult.model, rawModelOutput: modelResult.raw, actions });
        callbacks.onStep?.({ type: 'complete', tool: 'soc.done', output: operation.summary, screenshotBase64: afterDone.base64, details: { debugDir: debug.dir } });
        return { success: true, summary: operation.summary, history, debugDir: `~/.larund-click/soc-port/${runId}`, screenshot: afterDone };
      }
    }

    const after = await takeSocScreenshot();
    await debug.writeBase64('after-screenshot.jpg', after.base64);
    history.push({ step, screenshot, after, ocr, labels, model: modelResult.model, rawModelOutput: modelResult.raw, actions });
  }

  return {
    success: false,
    summary: '',
    history,
    debugDir: `~/.larund-click/soc-port/${runId}`,
    error: `SOC port reached maximum steps (${config.maxSteps})`,
  };
}

function extractExpectedText(objective: string): string | null {
  if (/alma/i.test(objective) && /ban/i.test(objective) && /sikeres/i.test(objective)) {
    return 'ALMA KORTE BANAN SIKERES SZILVA';
  }
  return null;
}

function ocrContainsExpected(ocr: Array<{ text: string }>, expected: string): boolean {
  const visible = normalizeSocText(ocr.map((item) => item.text).join(' '));
  return visible.includes(normalizeSocText(expected));
}
