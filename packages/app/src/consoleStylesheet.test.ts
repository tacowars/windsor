/** The stylesheet's shape, read through the reader the CSS tests share (windsor#472, windsor#477). */
import { describe, expect, it } from 'vitest';

import { braceBalance } from './consoleStylesheet';

describe('the stylesheet', () => {
  it('balances its braces', () => {
    expect(braceBalance()).toBe(0);
  });

  it('negative: a rule missing its closing brace is caught', () => {
    expect(braceBalance('.a { color: red; .b { color: blue; }')).toBe(1);
  });
});
