/**
 * Envelope edges at their own samples (windsor#301, record
 * `2026-10-01-envelope-edges-at-sample-rate`): an operator's amplitude ramp
 * reaches a segment's target at the segment's own sample, not at the end of
 * its 32-sample control block, and runs on the next segment's slope from
 * there. Driven through the shipped bundle (`__fixtures__/workletHarness.ts`)
 * with one carrier whose wave holds 1 (a digital square at 0.01 Hz, phase 0),
 * no filter and no drive, so each output sample is the carrier's heard
 * amplitude times one constant: the level a flat envelope holds.
 *
 * The voice hears the ramp's level after its increment, so the level a ramp
 * reaches at its knot `m` is heard at sample `m - 1`, as the old ramp's
 * block-end level was heard at the block's last sample.
 */
import { describe, expect, it } from 'vitest';

import type { Envelope as EnvelopeParams } from '../patch/patch';
import { LOOP_MODE, makeEnvelope, makePatch, WAVE } from '../patch/patch';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor, render } from '../__fixtures__/workletHarness';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = loaded.ctrlInterval;
const ALG_ADDITIVE = 7;
const BLOCKS = 4;
const NOTE_ON: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }];
/** A float32 sample's tolerance against the level it is scaled from. */
const CLOSE = 1e-6;

/**
 * Operator A alone, a held digital square at phase 0, under `env`. The
 * silent carriers B to D share it, so the voice ends when A's envelope does.
 */
function probePatch(env: Partial<EnvelopeParams>): unknown {
  const silent = { level: 0, env: makeEnvelope(env) };
  return makePatch({
    algorithm: ALG_ADDITIVE,
    ops: [
      {
        wave: WAVE.SQUARE_D,
        fixed: true,
        fixedHz: 0.01,
        phase: 0,
        phaseFree: false,
        level: 1,
        velSens: 0,
        env: makeEnvelope(env),
      },
      silent,
      silent,
      silent,
    ],
  });
}

/** The left channel of `blocks` render quanta of `events`, by default one note-on at frame 0. */
function heard(
  env: Partial<EnvelopeParams>,
  blocks = BLOCKS,
  specialise = true,
  events: ScheduledEvent[] = NOTE_ON,
): Float32Array {
  const processor = loaded.create(probePatch(env), 1, undefined, { specialise });
  const out = render(loaded, processor, blocks, events).samples;
  return out.filter((_, i) => i % 2 === 0);
}

/** The output of a flat level of 1: the scale every probe's samples carry. */
const UNIT = heard({ attackTime: 0, peakLevel: 1, sustainLevel: 1 })[200]!;

/** The probe's samples as levels. */
const levels = (env: Partial<EnvelopeParams>, blocks?: number): number[] =>
  Array.from(heard(env, blocks), (s) => s / UNIT);

/** The first sample at `level`, from sample `from`. */
const firstAt = (xs: number[], level: number, from = 0): number =>
  xs.findIndex((x, s) => s >= from && Math.abs(x - level) < CLOSE);

describe('an operator envelope edge inside a control block (windsor#301)', () => {
  it('steps to full level on the note-on sample with an attack of 0', () => {
    const xs = levels({ attackTime: 0, peakLevel: 1, decayTime: 1, sustainLevel: 1 });
    expect(UNIT).toBeGreaterThan(0);
    expect(xs[0]).toBeCloseTo(1, 6);
  });

  it('reaches the peak of a 0.1 ms attack about 5 samples in, not at the block end', () => {
    const xs = levels({ attackTime: 0.0001, peakLevel: 1, decayTime: 1, sustainLevel: 1 });
    const peak = firstAt(xs, 1);
    expect(Math.abs(peak - 5)).toBeLessThanOrEqual(1);
    expect(peak).toBeLessThan(BLOCK - 1);
    expect(xs[peak - 1]).toBeLessThan(1);
    // A ramp, not a step: the level rises through the attack.
    expect(xs[1]).toBeGreaterThan(xs[0]!);
  });

  it('lands a decay that ends mid-block on its sustain at its own sample, after an attack ending in the same block', () => {
    // The attack ends at 48 (16 into the second block), the decay 12 later at
    // 60 (28 into it): two knots in one block.
    const xs = levels({
      attackTime: 48 / SR,
      peakLevel: 1,
      decayTime: 12 / SR,
      sustainLevel: 0.25,
    });
    const peak = firstAt(xs, 1);
    expect(Math.abs(peak - 48)).toBeLessThanOrEqual(1);
    const landed = firstAt(xs, 0.25, peak);
    expect(Math.abs(landed - 60)).toBeLessThanOrEqual(1);
    for (let s = landed; s < xs.length; s++) expect(xs[s]).toBeCloseTo(0.25, 6);
  });

  it('releases fast too: a 0.2 ms release from a held note reaches 0 about 10 samples in', () => {
    const processor = loaded.create(
      probePatch({ attackTime: 0, sustainLevel: 1, releaseTime: 0.0002 }),
      1,
    );
    const off: ScheduledEvent[] = [
      ...NOTE_ON,
      // On a control block boundary, so the release starts there.
      { type: 'noteOff', id: 1, frame: 4 * BLOCK },
    ];
    const out = render(loaded, processor, BLOCKS, off).samples.filter((_, i) => i % 2 === 0);
    const xs = Array.from(out, (s) => s / UNIT);
    const start = 4 * BLOCK;
    const silent = xs.findIndex((x, s) => s >= start && Math.abs(x) < CLOSE);
    expect(Math.abs(silent - start - 10)).toBeLessThanOrEqual(1);
  });

  it('renders a segment longer than a block as the block-rate ramp did until the block it ends in', () => {
    // A 10 ms attack: 480 samples, 15 blocks; the model is the old ramp, a
    // float32 step per sample to the envelope's level at each block's end.
    const params = makeEnvelope({ attackTime: 0.01, peakLevel: 1, sustainLevel: 1 });
    const xs = levels(params, 8);
    const env = loaded.envelope(params);
    env.noteOn();
    let amp = 0;
    let checked = 0;
    for (let k = 0; k < 14; k++) {
      env.advance(BLOCK);
      const inc = Math.fround((env.value - amp) / BLOCK);
      for (let s = 0; s < BLOCK; s++) {
        amp = Math.fround(amp + inc);
        expect(Math.abs(xs[k * BLOCK + s]! - amp)).toBeLessThan(CLOSE);
        checked++;
      }
    }
    expect(checked).toBe(14 * BLOCK);
  });

  it('plays the same bits in the generic loop as in the kernel', () => {
    const env = { attackTime: 0.0001, peakLevel: 1, decayTime: 0.0003, sustainLevel: 0.3 };
    const kernel = heard(env, BLOCKS, true);
    const generic = heard(env, BLOCKS, false);
    expect(Buffer.compare(Buffer.from(kernel.buffer), Buffer.from(generic.buffer))).toBe(0);
  });

  it('keeps a released Trigger hit alive while its knots are still ahead in the block', () => {
    // A Trigger envelope runs its whole course inside the first block's
    // advance: 10 flat samples at 0, a 10-sample rise to 1 and a 10-sample
    // release to 0, so it has finished with three knots still ahead. A
    // note-off at frame 1 and another event at frame 2 split the render
    // there, while the ramp is still at 0: the hit must still play in full.
    const env = {
      initLevel: 0,
      attackTime: 10 / SR,
      peakLevel: 0,
      decayTime: 10 / SR,
      sustainLevel: 1,
      releaseTime: 10 / SR,
      endLevel: 0,
      loopMode: LOOP_MODE.TRIGGER,
    };
    const split: ScheduledEvent[] = [
      ...NOTE_ON,
      { type: 'noteOff', id: 1, frame: 1 },
      { type: 'noteOff', id: 2, frame: 2 },
    ];
    for (const specialise of [true, false]) {
      const hit = heard(env, 1, specialise, split);
      const xs = Array.from(hit, (s) => s / UNIT);
      const peak = firstAt(xs, 1);
      expect(Math.abs(peak - 20)).toBeLessThanOrEqual(1);
      expect(xs[5]).toBeCloseTo(0, 6);
      expect(Math.abs(firstAt(xs, 0, peak) - 30)).toBeLessThanOrEqual(1);
      // The split changes nothing: the same bits as the unbroken hit.
      const whole = heard(env, 1, specialise);
      expect(Buffer.compare(Buffer.from(hit.buffer), Buffer.from(whole.buffer))).toBe(0);
    }
  });
});
