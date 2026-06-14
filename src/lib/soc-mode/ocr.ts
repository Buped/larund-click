import { invoke } from '@tauri-apps/api/core';
import type { SocOcrBox, SocScreenshot } from './types';

interface RawOcrBox {
  text?: string;
  bbox?: { x: number; y: number; width: number; height: number } | [number, number, number, number];
  confidence?: number;
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeText(value).split(' ').filter(Boolean));
}

export function fuzzyScore(needle: string, haystack: string): number {
  const n = normalizeText(needle);
  const h = normalizeText(haystack);
  if (!n || !h) return 0;
  if (h === n) return 1;
  if (h.includes(n) || n.includes(h)) return 0.92;
  const ns = tokenSet(n);
  const hs = tokenSet(h);
  if (!ns.size || !hs.size) return 0;
  let overlap = 0;
  for (const token of ns) if (hs.has(token)) overlap += 1;
  return overlap / Math.max(ns.size, hs.size);
}

export function parseOcrJson(raw: string): SocOcrBox[] {
  let parsed: RawOcrBox[];
  try {
    parsed = JSON.parse(raw) as RawOcrBox[];
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
    }];
  });
}

export async function readOcr(screenshot: SocScreenshot): Promise<SocOcrBox[]> {
  const raw = await invoke<string>('ocr_read_region', {
    region: { x: 0, y: 0, width: screenshot.width, height: screenshot.height },
  });
  return parseOcrJson(raw);
}

export function findOcrText(ocr: SocOcrBox[], text: string): SocOcrBox | null {
  let best: { box: SocOcrBox; score: number } | null = null;
  for (const box of ocr) {
    const score = fuzzyScore(text, box.text);
    if (!best || score > best.score) best = { box, score };
  }
  return best && best.score >= 0.58 ? best.box : null;
}
