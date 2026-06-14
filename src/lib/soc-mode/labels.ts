import type { SocLabelBox, SocLabelOverlay, SocOcrBox, SocScreenshot } from './types';
import { clampBBox } from './coordinates';

export function buildLabelMap(ocr: SocOcrBox[], screenshot: Pick<SocScreenshot, 'width' | 'height'>): SocLabelBox[] {
  const labels: SocLabelBox[] = [];
  for (const box of ocr) {
    const idx = labels.length + 1;
    labels.push({
      label: `~${idx}`,
      bbox: clampBBox(box.bbox, screenshot.width, screenshot.height),
      source: 'ocr',
      text: box.text,
    });
  }

  const lineGroups = groupNearbyWords(ocr);
  for (const group of lineGroups) {
    if (group.length < 2) continue;
    const idx = labels.length + 1;
    const bbox = clampBBox([
      Math.min(...group.map((b) => b.bbox[0])) - 8,
      Math.min(...group.map((b) => b.bbox[1])) - 8,
      Math.max(...group.map((b) => b.bbox[2])) + 8,
      Math.max(...group.map((b) => b.bbox[3])) + 8,
    ], screenshot.width, screenshot.height);
    labels.push({
      label: `~${idx}`,
      bbox,
      source: 'visual',
      description: `text group: ${group.map((b) => b.text).join(' ')}`,
      text: group.map((b) => b.text).join(' '),
    });
  }

  return labels;
}

function groupNearbyWords(ocr: SocOcrBox[]): SocOcrBox[][] {
  const sorted = [...ocr].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  const rows: SocOcrBox[][] = [];
  for (const box of sorted) {
    const cy = (box.bbox[1] + box.bbox[3]) / 2;
    const row = rows.find((items) => {
      const first = items[0];
      const rcy = (first.bbox[1] + first.bbox[3]) / 2;
      return Math.abs(rcy - cy) <= 14;
    });
    if (row) row.push(box);
    else rows.push([box]);
  }
  return rows.map((row) => row.sort((a, b) => a.bbox[0] - b.bbox[0]));
}

export async function buildLabelOverlay(
  screenshot: SocScreenshot,
  labels: SocLabelBox[],
): Promise<SocLabelOverlay> {
  if (typeof document === 'undefined') {
    return { imageBase64: screenshot.base64, labels };
  }

  const image = await loadImage(`data:image/jpeg;base64,${screenshot.base64}`);
  const canvas = document.createElement('canvas');
  canvas.width = screenshot.width;
  canvas.height = screenshot.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { imageBase64: screenshot.base64, labels };
  ctx.drawImage(image, 0, 0);
  ctx.lineWidth = 2;
  ctx.font = 'bold 18px sans-serif';
  ctx.textBaseline = 'top';
  for (const item of labels) {
    const [x1, y1, x2, y2] = item.bbox;
    ctx.strokeStyle = 'rgb(255,0,0)';
    ctx.fillStyle = 'rgba(255,0,0,0.88)';
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
    const textWidth = ctx.measureText(item.label).width + 8;
    const labelY = Math.max(0, y1 - 22);
    ctx.fillRect(x1, labelY, textWidth, 20);
    ctx.fillStyle = 'white';
    ctx.fillText(item.label, x1 + 4, labelY + 1);
  }
  return { imageBase64: canvas.toDataURL('image/jpeg', 0.86).split(',')[1], labels };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('label_overlay_image_load_failed'));
    img.src = src;
  });
}

export function findLabel(labels: SocLabelBox[], label: string): SocLabelBox | null {
  return labels.find((item) => item.label === label.trim()) ?? null;
}
