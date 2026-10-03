import { describe, expect, it } from 'vitest';
import { EMPTY_GR_WINDOW, stepGrWindow } from './grReadout';

describe('stepGrWindow', () => {
  it('shows the mean of a window when the next one starts', () => {
    let step = stepGrWindow(EMPTY_GR_WINDOW, 2, 0, 100);
    expect(step.shown).toBeNull();
    step = stepGrWindow(step.window, 4, 50, 100);
    expect(step.shown).toBeNull();
    step = stepGrWindow(step.window, 9, 120, 100);
    expect(step.shown).toBe(3);
    step = stepGrWindow(step.window, 1, 210, 100);
    expect(step.shown).toBe(9);
  });
});
