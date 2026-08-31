/**
 * The transport and the generators emit events on the tick grid and know
 * nothing about audio (record `2026-08-31-generative-sequencing-transport-and-pitch`
 * §2). That is what lets a horde read the same onsets and lets these tests run
 * without a browser. This test reads the sources and fails the moment one of
 * them reaches the audio graph or a Web Audio type.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The pure set. A new generator joins this list, and the allowlist below. */
const PURE_FILES = [
  'scheduler.ts',
  'euclid.ts',
  'generatorSeed.ts',
  'noteEvent.ts',
  'scaleSampler.ts',
  'euclideanSequencer.ts',
  'arpeggiator.ts',
  'stepSequencer.ts',
];

const ALLOWED_IMPORTS = new Set([
  '@aotearoa/shared',
  ...PURE_FILES.map((f) => `./${f.replace(/\.ts$/, '')}`),
]);

/** Identifiers that would mean the boundary is crossed. Matched as whole words. */
const FORBIDDEN_IDENTIFIERS = [
  'AudioPart',
  'AudioSystem',
  'FmEngine',
  'fmEngine',
  'AudioContext',
  'BaseAudioContext',
  'OfflineAudioContext',
  'AudioNode',
  'AudioParam',
  'AudioBuffer',
  'AudioWorklet',
  'AudioWorkletNode',
  'GainNode',
  'OscillatorNode',
  'window',
  'document',
  'Date',
  'Math.random',
];

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/g;

describe.each(PURE_FILES)('%s stays on the pure side of the boundary', (file) => {
  const source = readFileSync(join(HERE, file), 'utf8');

  it('imports only the shared package and the other pure modules', () => {
    const specifiers = [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
    for (const spec of specifiers) {
      expect(ALLOWED_IMPORTS.has(spec), `${file} imports ${spec}`).toBe(true);
    }
  });

  it('names no audio-graph class, Web Audio type, DOM global or clock', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const id of FORBIDDEN_IDENTIFIERS) {
      const re = new RegExp(`(^|[^\\w.])${id.replace('.', '\\.')}(?![\\w])`);
      expect(re.test(code), `${file} mentions ${id}`).toBe(false);
    }
  });
});
