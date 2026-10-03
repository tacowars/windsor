/** The Figure's defaults (windsor#484): a bar of sixteenths in the song's meter, which the check passes. */
import { describe, expect, it } from 'vitest';

import { DEFAULT_FIGURE_CONFIG, assertFigureConfig, defaultFigureCells } from './figureSequencer';

describe('the default Figure (windsor#484)', () => {
  it('is one bar of sixteenths in the meter, tones 0, 1, 2, 1', () => {
    expect(defaultFigureCells('7/8')).toHaveLength(14);
    expect(defaultFigureCells('12/8')).toHaveLength(24);
    const tones = DEFAULT_FIGURE_CONFIG.cells.map((cell) =>
      cell.kind === 'note' ? cell.tone : -1,
    );
    expect(tones.slice(0, 5)).toEqual([0, 1, 2, 1, 0]);
    expect(() => assertFigureConfig(DEFAULT_FIGURE_CONFIG)).not.toThrow();
  });
});
