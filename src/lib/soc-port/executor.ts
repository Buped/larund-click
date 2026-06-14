import { invoke } from '@tauri-apps/api/core';
import { bboxCenterPercent, getTextElement } from './ocr';
import { parsePercent } from './validator';
import type { SocPortActionLog, SocPortLabelMap, SocPortOcrItem, SocPortOperation, SocPortScreenshot } from './types';

export async function executeSocPortOperation(args: {
  operation: SocPortOperation;
  screenshot: SocPortScreenshot;
  ocr: SocPortOcrItem[];
  labels?: SocPortLabelMap;
}): Promise<SocPortActionLog> {
  const { operation, screenshot, ocr, labels } = args;

  if (operation.operation === 'click' && 'text' in operation) {
    const matched = getTextElement(ocr, operation.text);
    if (!matched) {
      return {
        thought: operation.thought,
        operation,
        success: false,
        output: '',
        error: `ocr_text_not_found:${operation.text}`,
        source: 'ocr',
      };
    }
    const { center, percent } = bboxCenterPercent(matched, screenshot);
    const output = await invoke<string>('mouse_click_verified', {
      x: center.x,
      y: center.y,
      targetLabel: matched.text,
      bbox: matched.bbox,
      confidence: matched.confidence,
      source: 'soc-port-ocr',
    });
    return {
      thought: operation.thought,
      operation,
      success: true,
      output,
      matchedText: matched.text,
      originalBbox: matched.bbox,
      center,
      percent,
      source: 'ocr',
    };
  }

  if (operation.operation === 'click' && 'label' in operation) {
    const bbox = labels?.labelCoordinates[operation.label];
    if (!bbox) {
      return {
        thought: operation.thought,
        operation,
        success: false,
        output: '',
        error: `label_not_found:${operation.label}`,
        source: 'label',
      };
    }
    const center = { x: Math.round((bbox[0] + bbox[2]) / 2), y: Math.round((bbox[1] + bbox[3]) / 2) };
    const percent = { x: Number((center.x / screenshot.width).toFixed(3)), y: Number((center.y / screenshot.height).toFixed(3)) };
    const output = await invoke<string>('mouse_click_verified', {
      x: center.x,
      y: center.y,
      targetLabel: operation.label,
      bbox,
      confidence: 0.8,
      source: 'soc-port-label',
    });
    return {
      thought: operation.thought,
      operation,
      success: true,
      output,
      matchedLabel: operation.label,
      originalBbox: bbox,
      center,
      percent,
      source: 'label',
    };
  }

  if (operation.operation === 'click') {
    const xPercent = parsePercent(operation.x);
    const yPercent = parsePercent(operation.y);
    const center = {
      x: Math.round(xPercent * screenshot.width),
      y: Math.round(yPercent * screenshot.height),
    };
    await invoke('soc_mouse_click', { x: center.x, y: center.y, button: 'left' });
    return {
      thought: operation.thought,
      operation,
      success: true,
      output: `clicked percent ${xPercent},${yPercent}`,
      center,
      percent: { x: xPercent, y: yPercent },
      source: 'standard',
    };
  }

  if (operation.operation === 'write') {
    await invoke('type_text', { text: operation.content });
    return {
      thought: operation.thought,
      operation,
      success: true,
      output: `typed ${operation.content.length} chars`,
      source: 'keyboard',
    };
  }

  if (operation.operation === 'press') {
    if (operation.keys.length === 1) await invoke('key_press', { key: operation.keys[0] });
    else await invoke('key_combo', { keys: operation.keys });
    return {
      thought: operation.thought,
      operation,
      success: true,
      output: `pressed ${operation.keys.join('+')}`,
      source: 'keyboard',
    };
  }

  return {
    thought: operation.thought,
    operation,
    success: true,
    output: operation.summary,
    source: 'done',
  };
}
