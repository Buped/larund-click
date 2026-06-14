import type { BBox, GridCell, GridSpec, Point, ScreenRegion } from './types';
import { bboxCenter, clamp } from './geometry';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function columnLabel(index: number): string {
  let n = index;
  let label = '';
  do {
    label = LETTERS[n % 26] + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

export function parseColumnLabel(label: string): number | null {
  const upper = label.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) return null;
  let n = 0;
  for (const ch of upper) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function makeGrid(region: ScreenRegion, cellSize: number): GridSpec {
  const size = Math.max(1, Math.round(cellSize));
  return {
    cellSize: size,
    origin: [region.x, region.y],
    width: region.width,
    height: region.height,
    cols: Math.max(1, Math.ceil(region.width / size)),
    rows: Math.max(1, Math.ceil(region.height / size)),
  };
}

export function cellId(col: number, row: number): string {
  return `${columnLabel(col)}${String(row + 1).padStart(2, '0')}`;
}

export function parseCellId(id: string): { col: number; row: number } | null {
  const match = id.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = parseColumnLabel(match[1]);
  const row = Number(match[2]) - 1;
  if (col == null || !Number.isInteger(row) || row < 0) return null;
  return { col, row };
}

export function getCell(grid: GridSpec, id: string): GridCell | null {
  const parsed = parseCellId(id);
  if (!parsed) return null;
  if (parsed.col < 0 || parsed.col >= grid.cols || parsed.row < 0 || parsed.row >= grid.rows) return null;
  const x1 = grid.origin[0] + parsed.col * grid.cellSize;
  const y1 = grid.origin[1] + parsed.row * grid.cellSize;
  const x2 = Math.min(grid.origin[0] + grid.width, x1 + grid.cellSize);
  const y2 = Math.min(grid.origin[1] + grid.height, y1 + grid.cellSize);
  const bbox: BBox = [x1, y1, x2, y2];
  return { id: cellId(parsed.col, parsed.row), col: parsed.col, row: parsed.row, bbox, center: bboxCenter(bbox) };
}

export function cellAtPoint(grid: GridSpec, point: Point): GridCell | null {
  const col = Math.floor((point[0] - grid.origin[0]) / grid.cellSize);
  const row = Math.floor((point[1] - grid.origin[1]) / grid.cellSize);
  return getCell(grid, cellId(clamp(col, 0, grid.cols - 1), clamp(row, 0, grid.rows - 1)));
}

export function cropAroundCell(cell: GridCell, screen: { width: number; height: number }, size: number): ScreenRegion {
  const half = Math.round(size / 2);
  const cx = cell.center[0];
  const cy = cell.center[1];
  const x = clamp(cx - half, 0, Math.max(0, screen.width - size));
  const y = clamp(cy - half, 0, Math.max(0, screen.height - size));
  return { x, y, width: Math.min(size, screen.width - x), height: Math.min(size, screen.height - y) };
}
