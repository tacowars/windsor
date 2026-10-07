/**
 * The palette is spelled twice — once here for the canvases and inline SVG,
 * once in `console.css`'s custom properties — so the copy carries an
 * equality test against the source (#618 decision 4; CLAUDE.md "one
 * definition"). A hue tuned in one place without the other fails here.
 */
import { describe, expect, it } from 'vitest';

import { PART_COLOURS } from '@windsor/engine';
import {
  CARRIER_COLOR,
  CSS_VARIABLE_OF,
  HOT_COLOR,
  MOD_COLOR,
  PART_COLORS,
  RETURN_COLOR,
  SEQ_LANE_COLOR,
  partColor,
} from './consoleColors';
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

describe('the part palette', () => {
  it('holds one entry per colour the engine assigns, starting Sky, Lemon, Raspberry', () => {
    expect(PART_COLORS).toHaveLength(PART_COLOURS);
    expect(PART_COLORS.slice(0, 3).map((c) => c.name)).toEqual(['Sky', 'Lemon', 'Raspberry']);
    expect(new Set(PART_COLORS.map((c) => c.hex.toLowerCase())).size).toBe(PART_COLOURS);
  });

  it('never uses one of the console’s reserved accents', () => {
    const accents = [CARRIER_COLOR, MOD_COLOR, RETURN_COLOR, SEQ_LANE_COLOR, HOT_COLOR];
    const reserved = new Set(accents.map((hex) => hex.toLowerCase()));
    for (const { name, hex } of PART_COLORS)
      expect(reserved.has(hex.toLowerCase()), name).toBe(false);
  });

  it('reads a part’s colour by its index', () => {
    expect(partColor(2)).toEqual({ name: 'Raspberry', hex: '#BC3D6D' });
    expect(partColor(13).name).toBe('Olive');
  });
});
