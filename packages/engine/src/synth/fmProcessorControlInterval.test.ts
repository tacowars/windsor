/**
 * Each voice's control interval from its state (windsor#326, record
 * `2026-10-03-adaptive-control-interval`), through the shipped bundle: 32
 * samples while anything on the voice is fast, 128 while nothing is.
 *
 * - With the long interval at the fine one (`controlIntervals`, a table the
 *   test sets, not the constant) every factory preset renders the bits it
 *   rendered before windsor#326: `__fixtures__/fmGoldenFineInterval.json`
 *   holds the golden table's default path as it stood then. A DSP change
 *   that refreshes `fmGolden.json` refreshes this table too, with the
 *   command in `REFRESH`.
 * - A long block lands a segment end and the next one inside it on their
 *   own samples (windsor#301's knots), in the kernel and the generic loop.
 * - A slow attack and a slow LFO play in the long regime as in the fine one:
 *   the amplitude within 0.05 dB at every sample, the LFO's level within
 *   1e-6 at every long boundary.
 * - A note-off reaches a long voice within one long block, and a fine voice
 *   within one fine block.
 *
 * The probe (`fmProcessorEnvelopeEdges.test.ts`'s): one carrier whose wave
 * holds 1, so each output sample is its amplitude times one constant.
 */
// reads-by-path: packages/engine/src/__fixtures__/**, .nvmrc
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import fineTable from '../__fixtures__/fmGoldenFineInterval.json';
import type { CreateOptions, ScheduledEvent } from '../__fixtures__/workletHarness';
import { DEFAULT_SEED, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { Envelope as EnvelopeParams } from '../patch/patch';
import { makeEnvelope, makePatch, WAVE } from '../patch/patch';
import { PRESET_NAMES, PRESETS } from '../patch/presets';

const REFRESH =
  'A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/engine/src/synth/fmProcessorControlInterval.test.ts';
const refreshing = process.env['A204_REFRESH_FM_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/fmGoldenFineInterval.json', import.meta.url));
/** The Node major the table was written under (`fmProcessorGolden.test.ts` says why). */
const EXPECTED_MAJOR = readFileSync(new URL('../../../../.nvmrc', import.meta.url), 'utf8')
  .trim()
  .replace(/^v/, '')
  .split('.')[0];
const RIGHT_NODE = process.versions.node.split('.')[0] === EXPECTED_MAJOR;

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const QUANTUM = 128;
const FINE = loaded.ctrlInterval;
const LONG = 128;
/** The part's table with the long interval at the fine one: the render before windsor#326. */
const FINE_TABLE: CreateOptions = { controlIntervals: { long: FINE } };
const ALG_ADDITIVE = 7;
const NOTE_ON: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
const CLOSE = 1e-6;

const quantaFor = (seconds: number): number => Math.ceil((seconds * SR) / QUANTUM);

/** `fmProcessorGolden.test.ts`'s chord: off the block and control boundaries, one note slid, one released early. */
const CHORD: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 40, velocity: 0.9, frame: 0 },
  { type: 'noteOn', id: 2, note: 59, velocity: 0.55, mod: 0.4, frame: 1 },
  { type: 'noteOn', id: 3, note: 76, velocity: 0.35, frame: 2 * QUANTUM + 33 },
  { type: 'noteOn', id: 4, note: 64, velocity: 0.7, slide: true, frame: 5 * QUANTUM + 9 },
  { type: 'noteOff', id: 2, frame: quantaFor(0.2) * QUANTUM + 7 },
];
const RELEASE: ScheduledEvent[] = [
  { type: 'noteOff', id: 1, frame: 1 },
  { type: 'noteOff', id: 3, frame: 65 },
  { type: 'noteOff', id: 4, frame: 66 },
];

/** The golden test's render of preset `name`, hashed, with the long interval at the fine one. */
function fineHash(name: string): string {
  const processor = loaded.create(PRESETS[name], 16, DEFAULT_SEED, FINE_TABLE);
  const hash = createHash('sha256');
  for (const [seconds, events] of [
    [0.4, CHORD],
    [0.6, RELEASE],
  ] as const) {
    const { samples } = render(loaded, processor, quantaFor(seconds), events);
    hash.update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  }
  return hash.digest('hex');
}

/** Operator A alone, a held digital square at phase 0, under `env`; `extra` over the patch. */
function probe(env: Partial<EnvelopeParams>, extra: Record<string, unknown> = {}): unknown {
  const silent = { level: 0, env: makeEnvelope(env) };
  const carrier = { wave: WAVE.SQUARE_D, fixed: true, fixedHz: 0.01, phase: 0, phaseFree: false };
  return makePatch({
    algorithm: ALG_ADDITIVE,
    ops: [{ ...carrier, level: 1, velSens: 0, env: makeEnvelope(env) }, silent, silent, silent],
    ...extra,
  });
}

/** The left channel of `quanta` render quanta of `patch`, as raw samples. */
function heard(patch: unknown, quanta: number, events: ScheduledEvent[], options: CreateOptions) {
  const processor = loaded.create(patch, 1, undefined, options);
  return render(loaded, processor, quanta, events).samples.filter((_, i) => i % 2 === 0);
}

/** The output of a flat level of 1: the scale every probe's samples carry. */
const UNIT = heard(probe({ attackTime: 0, peakLevel: 1, sustainLevel: 1 }), 2, NOTE_ON, {})[200]!;

/** The probe's samples as levels. */
const levels = (patch: unknown, quanta: number, events = NOTE_ON, options: CreateOptions = {}) =>
  Array.from(heard(patch, quanta, events, options), (s) => s / UNIT);

/** The first sample at `level`, from sample `from`. */
const firstAt = (xs: number[], level: number, from = 0): number =>
  xs.findIndex((x, s) => s >= from && Math.abs(x - level) < CLOSE);

const fineHashes: Record<string, string> = fineTable.hashes;
const fresh: Record<string, string> = {};

describe('with the long interval at the fine one, the factory bank renders as before (windsor#326)', () => {
  it('runs under the Node major the table was written on', () => {
    expect(RIGHT_NODE, `the table is pinned to Node ${EXPECTED_MAJOR} (.nvmrc)`).toBe(true);
  });

  it.runIf(RIGHT_NODE).each(PRESET_NAMES)('%s', (name) => {
    fresh[name] = fineHash(name);
    if (refreshing) return;
    expect(
      fresh[name],
      `${name} renders differently from __fixtures__/fmGoldenFineInterval.json with every ` +
        `control block fine. If the change is intended, refresh it with \`${REFRESH}\`.`,
    ).toBe(fineHashes[name]);
  });
});

afterAll(() => {
  if (!refreshing || !RIGHT_NODE) return;
  const hashes = Object.fromEntries(
    Object.keys(fresh)
      .sort()
      .map((k) => [k, fresh[k]]),
  );
  const next = { ...fineTable, seed: DEFAULT_SEED, sampleRate: SR, hashes };
  writeFileSync(TABLE, `${JSON.stringify(next, null, 2)}\n`);
});

describe('a voice in the long regime (windsor#326)', () => {
  it("lands a long attack's end and a short decay's end inside one long block on their own samples", () => {
    // 0.102 s of attack, long from the note-on, ends 40 samples into its
    // 39th long block; the 30-sample decay ends 30 later, in the same block.
    const attack = 38 * LONG + 40;
    const decay = 30;
    expect(Math.floor(attack / LONG)).toBe(Math.floor((attack + decay) / LONG));
    const env = {
      attackTime: attack / SR,
      peakLevel: 1,
      decayTime: decay / SR,
      sustainLevel: 0.25,
    };
    const quanta = Math.ceil((attack + 2 * LONG) / QUANTUM);
    const kernel = levels(probe(env), quanta, NOTE_ON, { specialise: true });
    const generic = levels(probe(env), quanta, NOTE_ON, { specialise: false });
    expect(generic).toEqual(kernel);
    // The blocks are long ones: the fine table's render takes other steps.
    expect(levels(probe(env), quanta, NOTE_ON, FINE_TABLE)).not.toEqual(kernel);
    const peak = firstAt(kernel, 1);
    expect(Math.abs(peak - attack)).toBeLessThanOrEqual(1);
    const landed = firstAt(kernel, 0.25, peak);
    expect(Math.abs(landed - (attack + decay))).toBeLessThanOrEqual(1);
    for (let s = landed; s < kernel.length; s++) expect(kernel[s]).toBeCloseTo(0.25, 6);
  });

  it('plays a 2 s attack within 0.05 dB of the fine regime at every sample', () => {
    const patch = probe({ attackTime: 2, attackCurve: 0.5, peakLevel: 1, sustainLevel: 1 });
    const quanta = quantaFor(2.1);
    const long = levels(patch, quanta);
    const fine = levels(patch, quanta, NOTE_ON, FINE_TABLE);
    expect(long).not.toEqual(fine);
    let worst = 0;
    for (let s = 0; s < fine.length; s++) {
      expect(fine[s]).toBeGreaterThan(0);
      worst = Math.max(worst, Math.abs(20 * Math.log10(long[s]! / fine[s]!)));
    }
    expect(worst).toBeLessThan(0.05);
  });

  it('steps a 5 Hz LFO on pitch to the same level at every long boundary', () => {
    // A 0.5 s attack keeps the voice long from its note-on, so its blocks end
    // on the quanta's ends, where the fine regime's do too.
    const lfo = { rate: 5, amount: 1, toPitch: 1 };
    const patch = probe({ attackTime: 0.5, sustainLevel: 1 }, { lfo });
    const trace = (options: CreateOptions): number[] => {
      const processor = loaded.create(patch, 1, undefined, options);
      const seen: number[] = [];
      for (let q = 0; q < 100; q++) {
        render(loaded, processor, 1, q === 0 ? NOTE_ON : []);
        const voice = processor.voices.find((v) => v.active) as unknown as { lfoLevel: number };
        seen.push(voice.lfoLevel);
      }
      return seen;
    };
    const long = trace({});
    const fine = trace(FINE_TABLE);
    expect(Math.max(...long) - Math.min(...long)).toBeGreaterThan(1);
    for (let q = 0; q < long.length; q++) expect(Math.abs(long[q]! - fine[q]!)).toBeLessThan(1e-6);
  });

  it('hears a note-off within one long block, and a fine voice within one fine block', () => {
    // A step to a held 0.5 with a fast release. The fine voice carries an
    // 8 Hz LFO on silent operator B's level: fine throughout, heard nowhere.
    const env = { attackTime: 0, peakLevel: 0.5, sustainLevel: 0.5, releaseTime: 0.05 };
    const lfo = { rate: 8, amount: 1, toOp: [0, 1, 0, 0] };
    const latencies = (patch: unknown): number[] =>
      Array.from({ length: 9 }, (_, j) => 1000 + 17 * j).map((off) => {
        const events = [...NOTE_ON, { type: 'noteOff' as const, id: 1, frame: off }];
        const xs = levels(patch, Math.ceil((off + 2 * LONG) / QUANTUM), events);
        return xs.findIndex((x, s) => s >= off && x < 0.5 - CLOSE) - off;
      });
    const long = latencies(probe(env));
    const fine = latencies(probe(env, { lfo }));
    expect(Math.min(...long, ...fine)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...long)).toBeLessThanOrEqual(LONG);
    expect(Math.max(...long)).toBeGreaterThan(FINE);
    expect(Math.max(...fine)).toBeLessThanOrEqual(FINE);
  });
});
