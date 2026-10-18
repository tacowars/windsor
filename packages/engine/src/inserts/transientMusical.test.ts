/**
 * A real FM kick through the shipped Transient bundle (record
 * `2026-10-18-transient-insert`): the library's `kick` patch, four hits at
 * 128 BPM rendered by the shipped FM processor, then through the insert.
 * At Attack +15 the hits' front comes up and the peak stays under the
 * ceiling the shaping allows (the dry peak + 15 dB); at Sustain +24 the
 * tails come up and the peak stays under the dry peak + 24 dB; at
 * Sustain −24 the tails go down. Every sample is finite.
 */
import { expect, it } from 'vitest';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadTransient, transientParams } from '../__fixtures__/transientHarness';
import { PRESETS } from '../patch/presets';
import type { TransientSpec } from './transientSpec';

const BLOCK = 128;
const BEAT_S = 60 / 128;
const HITS = 4;
/** A track fader's headroom, as the drive's musical test leaves it. */
const TRACK_LEVEL = 0.5;

const dbOver = (v: number, ref: number): number => 20 * Math.log10(v / ref);

/** The kick's dry render at the track level, as interleaved stereo, and its rate. */
function kick(): { dry: Float32Array; rate: number } {
  const fm = loadProcessor();
  const beat = Math.round(BEAT_S * fm.sampleRate);
  const frames = Math.ceil((HITS * beat) / BLOCK) * BLOCK;
  const events: ScheduledEvent[] = [];
  for (let n = 0; n < HITS; n++) {
    events.push({ type: 'noteOn', id: n, note: 36, velocity: 1, frame: n * beat });
    events.push({ type: 'noteOff', id: n, frame: n * beat + Math.round(beat / 4) });
  }
  const { samples } = render(fm, fm.create(PRESETS['kick']!), frames / BLOCK, events);
  return { dry: samples.map((v) => TRACK_LEVEL * v), rate: fm.sampleRate };
}

/** `dry` through a Transient at `spec`: the output's peak, and its energy from 60 ms into each beat. */
function shaped(dry: Float32Array, rate: number, spec: Partial<TransientSpec>) {
  const params = transientParams(spec);
  const insert = loadTransient(rate, params);
  const frames = dry.length / 2;
  const beat = Math.round(BEAT_S * rate);
  const tailFrom = Math.round(0.06 * rate);
  let peak = 0,
    tail = 0,
    finite = true;
  const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const output = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  for (let frame = 0; frame < frames; frame += BLOCK) {
    for (let i = 0; i < BLOCK; i++) {
      input[0]![i] = dry[(frame + i) * 2]!;
      input[1]![i] = dry[(frame + i) * 2 + 1]!;
    }
    insert.process([input], [output], params);
    for (let i = 0; i < BLOCK; i++) {
      const x = output[0]![i]!;
      finite &&= Number.isFinite(x) && Number.isFinite(output[1]![i]!);
      peak = Math.max(peak, Math.abs(x), Math.abs(output[1]![i]!));
      if ((frame + i) % beat >= tailFrom) tail += x * x;
    }
  }
  return { peak, tail, finite };
}

it('shapes a real FM kick within the ceilings its settings allow', () => {
  const { dry, rate } = kick();
  const plain = shaped(dry, rate, {});
  expect(plain.peak).toBeGreaterThan(0.05);
  const front = shaped(dry, rate, { attack: 15 });
  const lifted = shaped(dry, rate, { sustain: 24 });
  const cut = shaped(dry, rate, { sustain: -24 });
  for (const run of [front, lifted, cut]) expect(run.finite).toBe(true);
  expect(dbOver(front.peak, plain.peak)).toBeGreaterThan(3);
  expect(dbOver(front.peak, plain.peak)).toBeLessThanOrEqual(15);
  expect(dbOver(lifted.peak, plain.peak)).toBeLessThanOrEqual(24);
  expect(lifted.tail).toBeGreaterThan(plain.tail);
  expect(cut.tail).toBeLessThan(plain.tail);
}, 20_000);
