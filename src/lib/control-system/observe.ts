import { invoke } from '@tauri-apps/api/core';
import type { CandidateSource, OcrWord, ScreenCapture, ScreenObservation, ScreenRegion, TargetCandidate } from './types';
import { bboxArea, regionToBBox } from './geometry';

interface CaptureResult { base64: string; width: number; height: number; monitor_id: number; }
interface RawOcrWord { text: string; bbox: ScreenRegion; confidence?: number; }
interface DesktopReadResult {
  window?: { title: string; process_name: string; bounds: ScreenRegion };
  targets?: Array<{
    id: string;
    name: string;
    role: string;
    bounds: ScreenRegion;
    enabled: boolean;
    visible: boolean;
    can_invoke?: boolean;
    is_large_container?: boolean;
    target_confidence?: number;
  }>;
}

export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function toCapture(raw: CaptureResult, region?: ScreenRegion): ScreenCapture {
  return {
    base64: raw.base64,
    width: raw.width,
    height: raw.height,
    monitorId: raw.monitor_id ?? 0,
    region,
    coordinateSpace: {
      kind: region ? 'region' : 'screen',
      origin: region ? [region.x, region.y] : [0, 0],
      width: region?.width ?? raw.width,
      height: region?.height ?? raw.height,
      dpiScale: 1,
      monitorId: raw.monitor_id ?? 0,
    },
  };
}

export async function captureRawScreen(monitorId?: number): Promise<ScreenCapture> {
  const raw = await invoke<CaptureResult>('capture_screen_raw', { monitorId: monitorId ?? null });
  if (!raw?.base64) throw new Error('no_screenshot_no_click');
  return toCapture(raw);
}

export async function captureScreenRegion(region: ScreenRegion, monitorId?: number): Promise<ScreenCapture> {
  const raw = await invoke<CaptureResult>('capture_screen_region', { monitorId: monitorId ?? null, region });
  if (!raw?.base64) throw new Error('no_screenshot_no_click');
  return toCapture(raw, region);
}

async function readUiaCandidates(): Promise<{ window?: DesktopReadResult['window']; candidates: TargetCandidate[]; log: string[] }> {
  const log: string[] = [];
  try {
    const raw = await invoke<string>('desktop_read', { mode: 'semantic', region: null });
    const parsed = JSON.parse(raw) as DesktopReadResult;
    const candidates = (parsed.targets ?? [])
      .filter((target) => target.visible && target.enabled && target.bounds.width > 2 && target.bounds.height > 2)
      .map((target, index): TargetCandidate => ({
        id: `uia_${index}_${target.id}`,
        source: 'uia',
        label: target.name || target.role,
        text: target.name || '',
        role: target.role || 'Unknown',
        bbox: regionToBBox(target.bounds),
        confidence: target.target_confidence ?? (target.name ? 0.62 : 0.35),
        clickable: !target.is_large_container,
        reasons: [`uia:${target.role}`, target.can_invoke ? 'can_invoke' : '', target.is_large_container ? 'large_container' : ''].filter(Boolean),
        metadata: target,
      }));
    log.push(`uia ${candidates.length}`);
    return { window: parsed.window, candidates, log };
  } catch (err) {
    log.push(`uia failed: ${String(err)}`);
    return { candidates: [], log };
  }
}

async function readOcrWords(region: ScreenRegion): Promise<OcrWord[]> {
  try {
    const raw = await invoke<string>('ocr_read_region', { region });
    const words = JSON.parse(raw) as RawOcrWord[];
    return Array.isArray(words)
      ? words
          .filter((word) => word.text?.trim() && word.bbox.width > 1 && word.bbox.height > 1)
          .map((word) => ({ text: word.text, bbox: word.bbox, confidence: word.confidence ?? 0.6 }))
      : [];
  } catch {
    return [];
  }
}

export function ocrWordsToLineCandidates(words: OcrWord[]): TargetCandidate[] {
  const sorted = [...words].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const lines: OcrWord[][] = [];
  for (const word of sorted) {
    const cy = word.bbox.y + word.bbox.height / 2;
    const line = lines.find((candidateLine) => {
      const first = candidateLine[0];
      const ly = first.bbox.y + first.bbox.height / 2;
      const right = Math.max(...candidateLine.map((w) => w.bbox.x + w.bbox.width));
      const gap = word.bbox.x - right;
      return Math.abs(ly - cy) <= Math.max(8, first.bbox.height * 0.8)
        && gap <= Math.max(80, first.bbox.height * 8);
    });
    if (line) line.push(word);
    else lines.push([word]);
  }
  return lines.map((line, index) => {
    const ordered = line.sort((a, b) => a.bbox.x - b.bbox.x);
    const text = ordered.map((word) => word.text).join(' ');
    const x1 = Math.min(...ordered.map((word) => word.bbox.x));
    const y1 = Math.min(...ordered.map((word) => word.bbox.y));
    const x2 = Math.max(...ordered.map((word) => word.bbox.x + word.bbox.width));
    const y2 = Math.max(...ordered.map((word) => word.bbox.y + word.bbox.height));
    return {
      id: `ocr_line_${index}`,
      source: 'ocr_group' as CandidateSource,
      label: text,
      text,
      role: 'TextLine',
      bbox: [x1, y1, x2, y2],
      confidence: Math.max(...ordered.map((word) => word.confidence)),
      clickable: true,
      reasons: ['ocr_line'],
    };
  });
}

export function inferCardCandidates(lines: TargetCandidate[], region: ScreenRegion): TargetCandidate[] {
  return lines
    .filter((line) => line.text.trim().length >= 2)
    .map((line, index): TargetCandidate => {
      const [x1, y1, x2, y2] = line.bbox;
      const width = Math.max(96, x2 - x1 + 48);
      const cardX1 = Math.max(region.x, Math.round((x1 + x2) / 2 - width / 2));
      const cardY1 = Math.max(region.y, y1 - 120);
      const cardX2 = Math.min(region.x + region.width, cardX1 + width);
      const cardY2 = Math.min(region.y + region.height, y2 + 24);
      return {
        id: `card_${index}_${line.id}`,
        source: 'heuristic',
        label: `${line.text} card`,
        text: line.text,
        role: 'Card',
        bbox: [cardX1, cardY1, cardX2, cardY2],
        confidence: Math.max(0.56, line.confidence * 0.9),
        clickable: true,
        reasons: ['ocr_text_to_card_bbox', `text_line=${line.id}`],
        metadata: { textLineBBox: line.bbox },
      };
    })
    .filter((candidate) => bboxArea(candidate.bbox) >= 1_000);
}

export async function observeScreen(opts: { monitorId?: number; regionHint?: ScreenRegion } = {}): Promise<ScreenObservation> {
  const capture = opts.regionHint
    ? await captureScreenRegion(opts.regionHint, opts.monitorId)
    : await captureRawScreen(opts.monitorId);
  const uia = await readUiaCandidates();
  const ocrRegion = opts.regionHint ?? uia.window?.bounds ?? { x: 0, y: 0, width: capture.width, height: capture.height };
  const ocrWords = await readOcrWords(ocrRegion);
  const ocrLines = ocrWordsToLineCandidates(ocrWords);
  const cards = inferCardCandidates(ocrLines, ocrRegion);
  return {
    id: `obs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    capture,
    activeWindowTitle: uia.window?.title ?? '',
    activeAppName: uia.window?.process_name ?? '',
    activeWindowRect: uia.window?.bounds,
    candidates: [...uia.candidates, ...ocrLines, ...cards],
    ocrWords,
    providerLog: [...uia.log, `ocr_words ${ocrWords.length}`, `ocr_lines ${ocrLines.length}`, `cards ${cards.length}`],
    timestamp: new Date().toISOString(),
  };
}

export function observationText(observation: ScreenObservation): string {
  return normalizeText([
    observation.activeAppName,
    observation.activeWindowTitle,
    ...observation.candidates.map((candidate) => `${candidate.label} ${candidate.text} ${candidate.role}`),
  ].join(' '));
}
