/**
 * A check the retired page generator (`build-editor.mjs`) made, kept as a test
 * now that Vite builds the page (Windsor fork, 2026-09-27): the console builds
 * no Web Audio nodes of its own for synthesis, routing or sequencing (#70); it
 * drives `AudioSystem` through `@windsor/engine`. The generator's other check,
 * the stylesheet's brace balance, sits beside the reader in
 * `consoleStylesheet.test.ts` (windsor#477).
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

describe('the console drives the engine, never a graph of its own', () => {
  it.each(CONSOLE_SOURCES)('%s builds no Web Audio nodes', (_name, source) => {
    for (const forbidden of FORBIDDEN_IN_CONSOLE_CODE) expect(source).not.toContain(forbidden);
  });
});
