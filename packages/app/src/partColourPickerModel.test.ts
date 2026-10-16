import { describe, expect, it } from 'vitest';
import { pickerPosition, swatchCaption } from './partColourPickerModel';
import { PICKER_PLACE } from './partColourPickerTables';

describe('the picker’s place', () => {
  const size = { width: 216, height: 100 };
  const viewport = { width: 1366, height: 768 };
  const chip = (left: number, right: number) => ({ left, right, top: 40, bottom: 78 });

  it('sits under the chip, its left edge on the chip’s', () => {
    expect(pickerPosition(chip(300, 432), size, viewport)).toEqual({
      x: 300,
      y: 78 + PICKER_PLACE.gapPx,
    });
  });

  it('stays on screen from the rightmost chip, and never past the left margin', () => {
    expect(pickerPosition(chip(1250, 1360), size, viewport).x).toBe(1366 - 216 - 8);
    expect(pickerPosition(chip(-30, 100), size, viewport).x).toBe(8);
  });

  it('goes above the chip when the window has no room below', () => {
    const low = { left: 300, right: 432, top: 700, bottom: 738 };
    expect(pickerPosition(low, size, viewport).y).toBe(700 - 4 - 100);
  });
});

describe('the name under the grid', () => {
  it('names the swatch under the pointer, or else the part’s colour', () => {
    expect(swatchCaption(null, 2)).toBe('Raspberry');
    expect(swatchCaption(10, 2)).toBe('Mint');
  });
});
