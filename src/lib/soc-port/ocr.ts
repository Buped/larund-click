import { invoke } from '@tauri-apps/api/core';
import type { SocPortOcrItem, SocPortScreenshot } from './types';

interface RawOcrItem {
  text?: string;
  bbox?: { x: number; y: number; width: number; height: number } | [number, number, number, number];
  confidence?: number;
}

export function normalizeSocText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function parseSocOcr(raw: string): SocPortOcrItem[] {
  let parsed: RawOcrItem[];
  try {
    parsed = JSON.parse(raw) as RawOcrItem[];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item, index) => {
    const text = String(item.text ?? '').trim();
    if (!text || !item.bbox) return [];
    const bbox = Array.isArray(item.bbox)
      ? item.bbox
      : [item.bbox.x, item.bbox.y, item.bbox.x + item.bbox.width, item.bbox.y + item.bbox.height];
    if (bbox.some((n) => !Number.isFinite(n))) return [];
    return [{
      id: `ocr-${index + 1}`,
      text,
      bbox: bbox.map((n) => Math.round(n)) as [number, number, number, number],
      confidence: Number.isFinite(item.confidence) ? Number(item.confidence) : 0.6,
      source: 'word' as const,
    }];
  });
}

export async function readSocOcr(screenshot: SocPortScreenshot): Promise<SocPortOcrItem[]> {
  const raw = await invoke<string>('ocr_read_region', {
    region: { x: 0, y: 0, width: screenshot.width, height: screenshot.height },
  });
  return parseSocOcr(raw);
}

export function getTextElement(ocr: SocPortOcrItem[], searchText: string): SocPortOcrItem | null {
  const needle = normalizeSocText(searchText);
  if (!needle || needle === 'nothing to click') return null;

  for (const item of ocr) {
    if (normalizeSocText(item.text).includes(needle)) return item;
  }

  const grouped = buildSplitWordFallbacks(ocr);
  for (const item of grouped) {
    if (normalizeSocText(item.text).includes(needle)) return item;
  }

  return null;
}

export function bboxCenterPercent(
  item: SocPortOcrItem,
  screenshot: Pick<SocPortScreenshot, 'width' | 'height'>,
): { center: { x: number; y: number }; percent: { x: number; y: number } } {
  const center = {
    x: Math.round((item.bbox[0] + item.bbox[2]) / 2),
    y: Math.round((item.bbox[1] + item.bbox[3]) / 2),
  };
  return {
    center,
    percent: {
      x: Number((center.x / screenshot.width).toFixed(3)),
      y: Number((center.y / screenshot.height).toFixed(3)),
    },
  };
}

function buildSplitWordFallbacks(ocr: SocPortOcrItem[]): SocPortOcrItem[] {
  const sorted = [...ocr].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const rows: SocPortOcrItem[][] = [];
  for (const item of sorted) {
    const cy = (item.bbox[1] + item.bbox[3]) / 2;
    const row = rows.find((entries) => Math.abs(((entries[0].bbox[1] + entries[0].bbox[3]) / 2) - cy) <= 14);
    if (row) row.push(item);
    else rows.push([item]);
  }

  return rows.flatMap((row, rowIndex) => {
    const words = row.sort((a, b) => a.bbox[0] - b.bbox[0]);
    const groups: SocPortOcrItem[] = [];
    for (let start = 0; start < words.length; start++) {
      for (let end = start + 1; end < Math.min(words.length, start + 5); end++) {
        const slice = words.slice(start, end + 1);
        groups.push({
          id: `ocr-group-${rowIndex + 1}-${start + 1}-${end + 1}`,
          text: slice.map((part) => part.text).join(' '),
          bbox: [
            Math.min(...slice.map((part) => part.bbox[0])),
            Math.min(...slice.map((part) => part.bbox[1])),
            Math.max(...slice.map((part) => part.bbox[2])),
            Math.max(...slice.map((part) => part.bbox[3])),
          ],
          confidence: slice.reduce((sum, part) => sum + part.confidence, 0) / slice.length,
          source: 'group',
        });
      }
    }
    return groups;
  });
}
