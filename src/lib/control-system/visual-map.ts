import type { GridSpec, ScreenCapture, ScreenRegion } from './types';
import { columnLabel, makeGrid } from './grid';

export interface VisualMap {
  capture: ScreenCapture;
  region: ScreenRegion;
  coarseGrid: GridSpec;
  coarseOverlayBase64: string;
}

async function imageFromBase64(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('grid_overlay_image_load_failed'));
    img.src = `data:image/jpeg;base64,${base64}`;
  });
}

export async function renderGridOverlay(capture: ScreenCapture, grid: GridSpec): Promise<string> {
  if (typeof document === 'undefined') return capture.base64;
  const canvas = document.createElement('canvas');
  canvas.width = capture.width;
  canvas.height = capture.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return capture.base64;
  try {
    const img = await imageFromBase64(capture.base64);
    ctx.drawImage(img, 0, 0, capture.width, capture.height);
  } catch {
    return capture.base64;
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.font = '12px sans-serif';
  const offsetX = capture.region?.x ?? 0;
  const offsetY = capture.region?.y ?? 0;
  for (let col = 0; col <= grid.cols; col++) {
    const x = grid.origin[0] - offsetX + col * grid.cellSize;
    ctx.beginPath();
    ctx.moveTo(x, grid.origin[1] - offsetY);
    ctx.lineTo(x, grid.origin[1] - offsetY + grid.height);
    ctx.stroke();
  }
  for (let row = 0; row <= grid.rows; row++) {
    const y = grid.origin[1] - offsetY + row * grid.cellSize;
    ctx.beginPath();
    ctx.moveTo(grid.origin[0] - offsetX, y);
    ctx.lineTo(grid.origin[0] - offsetX + grid.width, y);
    ctx.stroke();
  }
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const label = `${columnLabel(col)}${String(row + 1).padStart(2, '0')}`;
      const x = grid.origin[0] - offsetX + col * grid.cellSize + 2;
      const y = grid.origin[1] - offsetY + row * grid.cellSize + 12;
      if (grid.cellSize >= 18) ctx.fillText(label, x, y);
    }
  }
  ctx.restore();
  return canvas.toDataURL('image/jpeg', 0.86).replace(/^data:image\/jpeg;base64,/, '');
}

export async function buildVisualMap(capture: ScreenCapture, cellSize = 40): Promise<VisualMap> {
  const region = capture.region ?? { x: 0, y: 0, width: capture.width, height: capture.height };
  const coarseGrid = makeGrid(region, cellSize);
  return {
    capture,
    region,
    coarseGrid,
    coarseOverlayBase64: await renderGridOverlay(capture, coarseGrid),
  };
}
