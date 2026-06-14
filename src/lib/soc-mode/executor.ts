import { invoke } from '@tauri-apps/api/core';
import { bboxCenter, percentToPixel } from './coordinates';
import { findLabel } from './labels';
import { findOcrText } from './ocr';
import { isRepeatedFailedClick } from './history';
import type { SocExecutionLog, SocFailureMemory, SocLabelBox, SocOcrBox, SocOperation, SocScreenshot } from './types';

export interface SocExecuteContext {
  screenshot: SocScreenshot;
  ocr: SocOcrBox[];
  labels: SocLabelBox[];
  failures: SocFailureMemory;
  askUser?: (question: string) => Promise<string>;
}

export async function executeSocOperation(
  operation: SocOperation,
  ctx: SocExecuteContext,
): Promise<SocExecutionLog> {
  switch (operation.operation) {
    case 'click': {
      const pixel = percentToPixel(operation.x, operation.y, ctx.screenshot);
      return socClickPixel(pixel.x, pixel.y, operation, ctx, 'percent', { x: operation.x, y: operation.y });
    }
    case 'click_text': {
      const box = findOcrText(ctx.ocr, operation.text);
      if (!box) {
        return {
          operation: operation.operation,
          thought: operation.thought,
          success: false,
          output: '',
          error: `ocr_text_not_found:${operation.text}`,
          source: 'ocr',
          original: operation.text,
          screenshotSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
        };
      }
      const pixel = bboxCenter(box.bbox);
      return socClickPixel(pixel.x, pixel.y, operation, ctx, 'ocr', { text: operation.text, matched: box });
    }
    case 'click_label': {
      const label = findLabel(ctx.labels, operation.label);
      if (!label) {
        return {
          operation: operation.operation,
          thought: operation.thought,
          success: false,
          output: '',
          error: `label_not_found:${operation.label}`,
          source: 'label',
          original: operation.label,
          screenshotSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
        };
      }
      const pixel = bboxCenter(label.bbox);
      return socClickPixel(pixel.x, pixel.y, operation, ctx, 'label', { label });
    }
    case 'write':
      await invoke('type_text', { text: operation.content });
      return {
        operation: operation.operation,
        thought: operation.thought,
        success: true,
        output: `typed ${operation.content.length} chars`,
        source: 'keyboard',
      };
    case 'press':
      if (operation.keys.length === 1) await invoke('key_press', { key: operation.keys[0] });
      else await invoke('key_combo', { keys: operation.keys });
      return {
        operation: operation.operation,
        thought: operation.thought,
        success: true,
        output: `pressed ${operation.keys.join('+')}`,
        source: 'keyboard',
      };
    case 'wait': {
      const ms = Math.max(100, Math.min(operation.ms ?? 1000, 10_000));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return {
        operation: operation.operation,
        thought: operation.thought,
        success: true,
        output: `waited ${ms}ms`,
        source: 'wait',
      };
    }
    case 'ask_user': {
      const answer = await ctx.askUser?.(operation.question);
      return {
        operation: operation.operation,
        thought: operation.thought,
        success: true,
        output: answer ? `user answered: ${answer}` : operation.question,
        source: 'ask_user',
      };
    }
    case 'done':
      return {
        operation: operation.operation,
        thought: operation.thought,
        success: true,
        output: operation.summary,
        source: 'done',
      };
  }
}

async function socClickPixel(
  x: number,
  y: number,
  operation: SocOperation,
  ctx: SocExecuteContext,
  source: 'percent' | 'ocr' | 'label',
  original: unknown,
): Promise<SocExecutionLog> {
  if (isRepeatedFailedClick(ctx.failures, { x, y })) {
    return {
      operation: operation.operation,
      thought: operation.thought,
      success: false,
      output: '',
      error: `blocked_repeated_failed_click:${x},${y}`,
      source,
      original,
      pixel: { x, y },
      screen: { x, y },
      screenshotSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
      screenSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
    };
  }

  const bbox = [Math.max(0, x - 3), Math.max(0, y - 3), Math.min(ctx.screenshot.width - 1, x + 3), Math.min(ctx.screenshot.height - 1, y + 3)];
  const output = await invoke<string>('mouse_click_verified', {
    x,
    y,
    targetLabel: `soc:${source}`,
    bbox,
    confidence: source === 'percent' ? 0.55 : 0.82,
    source: `soc-${source}`,
  });

  return {
    operation: operation.operation,
    thought: operation.thought,
    success: true,
    output,
    source,
    original,
    pixel: { x, y },
    screen: { x, y },
    screenshotSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
    screenSize: { width: ctx.screenshot.width, height: ctx.screenshot.height },
  };
}
