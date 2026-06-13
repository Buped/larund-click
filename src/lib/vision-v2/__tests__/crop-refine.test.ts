import { describe, it, expect } from 'vitest';
import { cropToScreenPoint } from '../crop-refine';

describe('cropToScreenPoint', () => {
  const region = { x: 100, y: 200, width: 60, height: 40 };

  it('maps a crop-local point back to absolute screen coords (zoom 2)', () => {
    // local (40,20) at zoom 2 → 20,10 screen-px inside region → 120,210
    expect(cropToScreenPoint([40, 20], region, 2)).toEqual([120, 210]);
  });

  it('is the region origin at local 0,0', () => {
    expect(cropToScreenPoint([0, 0], region, 3)).toEqual([100, 200]);
  });

  it('clamps inside the region', () => {
    expect(cropToScreenPoint([10000, 10000], region, 1)).toEqual([160, 240]);
  });

  it('treats zoom < 1 as 1', () => {
    expect(cropToScreenPoint([10, 10], region, 0)).toEqual([110, 210]);
  });
});
