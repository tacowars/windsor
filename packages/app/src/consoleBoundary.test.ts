/**
 * The two checks the retired page generator (`build-editor.mjs`) made, kept as
 * a test now that Vite builds the page (Windsor fork, 2026-09-27):
 *
 *   - the console builds no Web Audio nodes of its own for synthesis, routing
 *     or sequencing (#70): it drives `AudioSystem` through `@windsor/engine`;
 *   - the stylesheet's braces balance. #610's Euclidean block once lost its
 *     closing brace and every later rule became a nested selector matching
 *     nothing, so the console rendered unstyled while everything stayed green.
 */
/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = new URL('./', import.meta.url);
const read = (relative: string): string => readFileSync(new URL(relative, SRC), 'utf8');

const FORBIDDEN_IN_CONSOLE_CODE = [
  'createGain(',
  'createBiquadFilter(',
  'new AudioWorkletNode',
  'createDynamicsCompressor(',
  'createOscillator(',
  'createStereoPanner(',
  'createDelay(',
  'audioWorklet.addModule',
];

/** The console's own code — the page and `src/`, not its tests, which may name a call in an assertion. */
const CONSOLE_SOURCES: readonly (readonly [string, string])[] = [
  ['index.html', read('../index.html')],
  ...readdirSync(SRC)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => [`src/${name}`, read(name)] as const),
];

function braceBalance(css: string): number {
  const code = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '');
  return code.split('{').length - code.split('}').length;
}

describe('the console drives the engine, never a graph of its own', () => {
  it.each(CONSOLE_SOURCES)('%s builds no Web Audio nodes', (_name, source) => {
    for (const forbidden of FORBIDDEN_IN_CONSOLE_CODE) expect(source).not.toContain(forbidden);
  });
});

describe('the stylesheet', () => {
  it('balances its braces', () => {
    expect(braceBalance(read('console.css'))).toBe(0);
  });

  it('negative: a rule missing its closing brace is caught', () => {
    expect(braceBalance('.a { color: red; .b { color: blue; }')).toBe(1);
  });
});
