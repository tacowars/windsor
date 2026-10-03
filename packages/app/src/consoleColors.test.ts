/**
 * The palette is spelled twice — once here for the canvases and inline SVG,
 * once in `console.css`'s custom properties — so the copy carries an
 * equality test against the source (#618 decision 4; CLAUDE.md "one
 * definition"). A hue tuned in one place without the other fails here.
 */
import { describe, expect, it } from 'vitest';

import { CSS_VARIABLE_OF } from './consoleColors';
import { cssHexProperties } from './consoleStylesheet';

describe('the console palette', () => {
  it('matches the stylesheet’s custom properties, hue for hue', () => {
    const vars = cssHexProperties();
    expect(vars.size).toBeGreaterThan(0);
    for (const [name, hex] of Object.entries(CSS_VARIABLE_OF)) {
      expect(vars.get(name)?.toLowerCase(), name).toBe(hex.toLowerCase());
    }
  });
});
