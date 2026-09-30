import { describe, expect, it } from 'vitest';
import { belowChromeRootMargin } from './stickyOffset';

describe("the bridge observer's margin below the header", () => {
  it('starts the header height below the top, in whole pixels', () => {
    expect(belowChromeRootMargin(48)).toBe('-48px 0px 0px 0px');
    expect(belowChromeRootMargin(96.4)).toBe('-96px 0px 0px 0px');
    expect(belowChromeRootMargin(96.6)).toBe('-97px 0px 0px 0px');
  });

  it('follows a wrap and an unwrap to a new margin', () => {
    expect(belowChromeRootMargin(48)).not.toBe(belowChromeRootMargin(92));
  });

  it('is zero without a header, and never positive', () => {
    expect(belowChromeRootMargin(0)).toBe('0px 0px 0px 0px');
    expect(belowChromeRootMargin(-5)).toBe('0px 0px 0px 0px');
    expect(belowChromeRootMargin(Number.NaN)).toBe('0px 0px 0px 0px');
  });
});
