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
  // The area's number tables (#250): data only, it imports nothing, and it is
  // checked here for the same forbidden identifiers so a generator can read
  // its tunables without leaving the pure side.
  '../audioConstants.ts',
  // The worklet's own data modules that `audioConstants.ts` re-exports (#656):
  // the algorithm table and the tunables, including the envelope curve's
  // steepness. Data only, importing nothing, and checked here like the rest.
  '../worklet/fm/algorithms.ts',
  '../worklet/fm/fmConstants.ts',
  // The patch defaults, whose `OPERATOR_COUNT` `audioConstants.ts` re-exports
  // (#670), and the two import-free id modules the defaults name.
  '../worklet/fm/patchDefaults.ts',
  '../worklet/fm/modeIds.ts',
  '../worklet/fm/waveIds.ts',
  'scheduler.ts',
  'euclid.ts',
  'generatorSeed.ts',
  'mulberry32.ts',
  'noteEvent.ts',
  'scaleSampler.ts',
  'euclideanSequencer.ts',
  // The written and performed kinds (#705): they read the key and the chord
  // the region gate hands them, never the graph.
  'gridSequencer.ts',
  'chordSequencer.ts',
  'arpSequencer.ts',
  // The arpeggiator (#706): the chord the gate hands it, voiced and walked.
  'arpeggiator.ts',
  'bassSequencer.ts',
  // The determinism-critical pair (#705): the position rule and the gate.
  'regionClock.ts',
  'regionGate.ts',
  // Harmony, all of it: theory, names, voicing, tables, the timeline and the
  // chord normaliser, which reaches only the field vocabulary and the types.
  '../harmony/chordTheory.ts',
  '../harmony/chordTables.ts',
  '../harmony/chordNames.ts',
  '../harmony/chordVoicing.ts',
  '../harmony/harmonyTimeline.ts',
  '../harmony/chordNormalise.ts',
  '../song/arrangementFields.ts',
  '../song/arrangement.ts',
];

/** The pure set by absolute path, so a specifier is judged by what it resolves to, not how it is spelled. */
const PURE_PATHS = new Set(PURE_FILES.map((f) => join(HERE, f)));

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

  it('imports only the other pure modules', () => {
    const specifiers = [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
    for (const spec of specifiers) {
      const allowed = PURE_PATHS.has(`${join(dirname(join(HERE, file)), spec)}.ts`);
      expect(allowed, `${file} imports ${spec}`).toBe(true);
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
