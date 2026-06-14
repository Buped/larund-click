import { getSocConfig } from './config';
import { buildLabelMap, buildLabelOverlay } from './labels';
import { callSocModel } from './model';
import { readOcr } from './ocr';
import { takeDesktopScreenshot } from './screenshot';
import { executeSocOperation } from './executor';
import { createFailureMemory, rememberFailedOperation, shouldBlockDone } from './history';
import { createSocDebugWriter } from './debug';
import type { SocFailureMemory, SocHistoryItem, SocLoopCallbacks, SocOperation } from './types';

export interface SocLoopResult {
  success: boolean;
  summary: string;
  screenshot?: { base64: string; width: number; height: number };
  history: SocHistoryItem[];
  debugDir: string;
  error?: string;
}

function screenshotChanged(before: string, after: string): boolean {
  if (!before || !after || before.length !== after.length) return before !== after;
  const stride = Math.max(1, Math.floor(before.length / 5000));
  let diff = 0;
  let total = 0;
  for (let i = 0; i < before.length; i += stride) {
    total += 1;
    if (before.charCodeAt(i) !== after.charCodeAt(i)) diff += 1;
  }
  return total > 0 && diff / total > getSocConfig().noChangeThreshold;
}

export async function runSocLoop(
  task: string,
  userId: string,
  callbacks: SocLoopCallbacks = {},
  initialFailures: SocFailureMemory = createFailureMemory(),
): Promise<SocLoopResult> {
  const config = getSocConfig();
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const history: SocHistoryItem[] = [];
  let failures = initialFailures;
  let lastScreenshot: { base64: string; width: number; height: number } | undefined;

  for (let step = 1; step <= config.maxSteps; step++) {
    const debug = createSocDebugWriter(runId, step);
    const screenshot = await takeDesktopScreenshot();
    lastScreenshot = screenshot;
    const ocr = await readOcr(screenshot).catch(() => []);
    const labels = buildLabelMap(ocr, screenshot);
    const overlay = await buildLabelOverlay(screenshot, labels);

    await debug.writeBase64('raw-screenshot.jpg', screenshot.base64);
    await debug.writeBase64('label-overlay.jpg', overlay.imageBase64);
    await debug.writeText('ocr.json', JSON.stringify(ocr, null, 2));
    await debug.writeText('labels.json', JSON.stringify(labels, null, 2));
    await debug.writeText('turn-context.json', JSON.stringify({
      task,
      step,
      mode: config.mode,
      model: config.primaryModel,
      screenshot: { width: screenshot.width, height: screenshot.height },
      history: history.map((item) => ({
        step: item.step,
        operation: item.operation,
        result: item.result,
      })),
      failures,
    }, null, 2));

    callbacks.onStep?.({
      type: 'thinking',
      output: `SOC visual observe: screenshot ${screenshot.width}x${screenshot.height}, OCR ${ocr.length}, labels ${labels.length}`,
      screenshotBase64: screenshot.base64,
      details: { mode: 'soc_visual', ocrCount: ocr.length, labelCount: labels.length, debugDir: debug.dir },
    });

    const ctx = {
      task,
      step,
      mode: config.mode,
      model: config.primaryModel,
      screenshot,
      ocr,
      labels,
      labeledScreenshotBase64: overlay.imageBase64,
      history,
      failures,
    };

    let operations: SocOperation[];
    let rawModelOutput = '';
    let modelUsed = config.primaryModel;
    try {
      const modelResult = await callSocModel(ctx, userId, config.fallbackModel);
      operations = modelResult.operations;
      rawModelOutput = modelResult.raw;
      modelUsed = modelResult.model;
      callbacks.addCost?.(modelResult.usage?.costUsd ?? 0);
      await debug.writeText('model-output.json', rawModelOutput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await debug.writeText('model-error.txt', message);
      callbacks.onStep?.({ type: 'error', tool: 'soc.model', error: message, details: { debugDir: debug.dir } });
      return { success: false, summary: '', history, debugDir: `~/.larund-click/soc-mode/${runId}`, error: message, screenshot: lastScreenshot };
    }

    const operation = operations[0];
    callbacks.onStep?.({
      type: 'tool_call',
      tool: `soc.${operation.operation}`,
      input: JSON.stringify(operation, null, 2),
      screenshotBase64: config.mode.includes('labeled') ? overlay.imageBase64 : screenshot.base64,
      details: { mode: 'soc_visual', model: modelUsed, ocrCount: ocr.length, labelCount: labels.length, debugDir: debug.dir },
    });

    if (operation.operation === 'done') {
      const result = await executeSocOperation(operation, { screenshot, ocr, labels, failures, askUser: callbacks.onAskUser });
      const blockReason = shouldBlockDone(history, task, operation.summary);
      if (!blockReason) {
        callbacks.onStep?.({
          type: 'complete',
          tool: 'soc.done',
          output: operation.summary,
          screenshotBase64: screenshot.base64,
          details: { mode: 'soc_visual', model: modelUsed, debugDir: debug.dir },
        });
        return { success: true, summary: operation.summary, history, debugDir: `~/.larund-click/soc-mode/${runId}`, screenshot };
      }
      const correction = `The task is not complete (${blockReason}). Continue from the current screen.`;
      history.push({ step, before: screenshot, after: screenshot, ocrCount: ocr.length, labelCount: labels.length, model: modelUsed, operation, result: { ...result, success: false, error: correction }, rawModelOutput });
      callbacks.onStep?.({
        type: 'error',
        tool: 'soc.done',
        error: correction,
        screenshotBase64: screenshot.base64,
        details: { mode: 'soc_visual', blockReason, debugDir: debug.dir },
      });
      continue;
    }

    const result = await executeSocOperation(operation, { screenshot, ocr, labels, failures, askUser: callbacks.onAskUser });
    const after = await takeDesktopScreenshot();
    const changed = screenshotChanged(screenshot.base64, after.base64);
    result.noChange = ['click', 'click_text', 'click_label'].includes(operation.operation) && !changed;
    if (!result.success || result.noChange) {
      failures = rememberFailedOperation(failures, operation, step, result.error ?? 'no_visual_change', result.pixel);
    }

    history.push({ step, before: screenshot, after, ocrCount: ocr.length, labelCount: labels.length, model: modelUsed, operation, result, rawModelOutput });
    lastScreenshot = after;

    await debug.writeBase64('after-screenshot.jpg', after.base64);
    await debug.writeText('execution-log.json', JSON.stringify(result, null, 2));

    callbacks.onStep?.({
      type: result.success && !result.noChange ? 'tool_result' : 'error',
      tool: `soc.${operation.operation}`,
      output: result.output,
      error: result.noChange ? 'no_visual_change_after_click' : result.error,
      screenshotBase64: after.base64,
      details: {
        mode: 'soc_visual',
        thought: operation.thought,
        model: modelUsed,
        clickSource: result.source,
        clicked: result.pixel,
        noChange: result.noChange,
        ocrCount: ocr.length,
        labelCount: labels.length,
        debugDir: debug.dir,
      },
    });

    if (operation.operation === 'ask_user') {
      continue;
    }
  }

  return {
    success: false,
    summary: '',
    history,
    debugDir: `~/.larund-click/soc-mode/${runId}`,
    error: `SOC reached maximum steps (${config.maxSteps})`,
    screenshot: lastScreenshot,
  };
}
