import { describe, expect, it } from 'vitest';
import { cellAtPoint, cellId, columnLabel, cropAroundCell, getCell, makeGrid, parseCellId } from '../grid';

describe('control-system grid', () => {
  it('maps cells to bbox and deterministic center points', () => {
    const grid = makeGrid({ x: 0, y: 0, width: 1920, height: 1080 }, 40);
    expect(grid.cols).toBe(48);
    expect(grid.rows).toBe(27);
    expect(getCell(grid, 'C03')).toMatchObject({
      id: 'C03',
      bbox: [80, 80, 120, 120],
      center: [100, 100],
    });
  });

  it('supports stable labels beyond Z', () => {
    expect(columnLabel(0)).toBe('A');
    expect(columnLabel(25)).toBe('Z');
    expect(columnLabel(26)).toBe('AA');
    expect(parseCellId('AA07')).toEqual({ col: 26, row: 6 });
  });

  it('maps points and crops around selected cells without leaving the screen', () => {
    const grid = makeGrid({ x: 100, y: 50, width: 320, height: 180 }, 20);
    const cell = cellAtPoint(grid, [135, 77]);
    expect(cell?.id).toBe(cellId(1, 1));
    expect(cropAroundCell(cell!, { width: 400, height: 250 }, 120)).toEqual({ x: 70, y: 20, width: 120, height: 120 });
  });
});
