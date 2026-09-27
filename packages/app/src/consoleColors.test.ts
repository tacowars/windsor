/**
 * The palette is spelled twice — once here for the canvases and inline SVG,
 * once in `console.css`'s custom properties — so the copy carries an
 * equality test against the source (#618 decision 4; CLAUDE.md "one
 * definition"). A hue tuned in one place without the other fails here.
 */
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CSS_VARIABLE_OF } from './consoleColors';

const STYLESHEET = new URL('./console.css', import.meta.url);

function cssVariables(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.matchAll(/(--[a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    if (match[1] && match[2] && !found.has(match[1])) found.set(match[1], match[2]);
  }
  return found;
}

describe('the console palette', () => {
  it('matches the stylesheet’s custom properties, hue for hue', () => {
    const vars = cssVariables(readFileSync(STYLESHEET, 'utf8'));
    expect(vars.size).toBeGreaterThan(0);
    for (const [name, hex] of Object.entries(CSS_VARIABLE_OF)) {
      expect(vars.get(name)?.toLowerCase(), name).toBe(hex.toLowerCase());
    }
  });
});
