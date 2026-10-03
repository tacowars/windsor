/**
 * The master column's layout numbers (windsor#194 decision 1). A media query
 * cannot read a custom property, so the stacking width is written twice:
 * once here and once in `console.css`. This pins the copy, the way
 * `consoleColors.test.ts` pins the palette.
 */
import { describe, expect, it } from 'vitest';

import {
  LEVEL_FADER_WIDTH_PX,
  MASTER_CHANNEL_WIDTH_PX,
  MASTER_COLUMN_WIDTH_PX,
  MASTER_STACK_MAX_WIDTH_PX,
} from './masterColumnTables';
import { CONSOLE_CSS as STYLESHEET } from './consoleStylesheet';

describe('the master column’s layout', () => {
  it('stacks at the table’s width in the stylesheet', () => {
    const query = `@media (max-width: ${MASTER_STACK_MAX_WIDTH_PX}px) {`;
    const at = STYLESHEET.indexOf(query);
    expect(at, query).toBeGreaterThan(-1);
    const block = STYLESHEET.slice(at, STYLESHEET.indexOf('\n}\n', at));
    expect(block).toContain('.mixer-layout {');
    expect(block).toContain('.master-column {');
    expect(block).toContain('position: static;');
  });

  it('fits the fader, five channels and the scale inside the column', () => {
    const SCALE_PX = 22;
    const PADDING_AND_BORDER_PX = 22;
    const meters = LEVEL_FADER_WIDTH_PX + 5 * MASTER_CHANNEL_WIDTH_PX + SCALE_PX;
    expect(meters).toBeLessThanOrEqual(MASTER_COLUMN_WIDTH_PX - PADDING_AND_BORDER_PX);
  });
});
