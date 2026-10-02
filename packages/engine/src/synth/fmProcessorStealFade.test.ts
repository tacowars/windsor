/**
 * A stolen voice fades out, and the quietest released tail goes first
 * (windsor#410). A slow pad with a long release fills a 12-voice part with
 * tails, and every chord hit from the third on used to steal four of them,
 * still loud, with a 4 ms fade: a pop on every hit. These render that loop
 * through the shipped bundle and hold the hit's second difference to the
 * pad's own motion, check that no voice is cut, and pin the stealing order.
 * The decision is `docs/log/2026-10-02-voice-steals-fade-the-quietest-tail.md`.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch } from '../patch/patch';
import type { Patch } from '../patch/patch';
import { PRESETS } from '../patch/presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;

/** A music part's sounding limit (`MUSIC_PART_MAX_VOICES`). */
const MUSIC_LIMIT = 12;
const PAD = PRESETS['str-ambient-evolve'] as Patch;
const C_MINOR = [48, 51, 55];
const VELOCITY = 0.8;
/** One bar at 120 bpm. */
const BAR_FRAMES = 2 * SR;
const BARS = 8;
/** The hit's window, and the pad's own motion from 200 ms to 100 ms before it. */
const AFTER_HIT = Math.round(0.01 * SR);
const BEFORE_FROM = Math.round(0.2 * SR);
const BEFORE_TO = Math.round(0.1 * SR);
/** A hit may move the signal at most twice as sharply as the pad already does. */
const MAX_HIT_RATIO = 2;

interface StealVoice {
  active: boolean;
  fading: boolean;
  finished: boolean;
  gate: boolean;
  dormant: boolean;
  voiceId: number;
  age: number;
}

const voicesOf = (processor: ProcessorLike): StealVoice[] =>
  processor.voices as unknown as StealVoice[];

/** A three-note hit every bar at gate 1: each note off one frame before the next hit. */
function chordEvents(chord: number[], bars: number): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  for (let bar = 0; bar < bars; bar++) {
    chord.forEach((note, n) => {
      const id = bar * chord.length + n + 1;
      const frame = bar * BAR_FRAMES;
      events.push({ type: 'noteOn', id, note, velocity: VELOCITY, frame });
      events.push({ type: 'noteOff', id, frame: frame + BAR_FRAMES - 1 });
    });
  }
  return events.sort((a, b) => a.frame - b.frame);
}

interface LoopResult {
  /** Interleaved stereo. */
  samples: Float32Array;
  /** Voices that held a sounding note before a block and a different one after it. */
  hardKills: number;
}

/**
 * Render `events` a block at a time, reading each voice before and after the
 * block: one that was sounding and not finished, and holds another note
 * after, was cut. A 30 ms fade outlasts a block, so a graceful steal never
 * turns over within one.
 */
function renderWatched(
  processor: ProcessorLike,
  blocks: number,
  events: ScheduledEvent[],
  firstBlock = 0,
): LoopResult {
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const samples = new Float32Array(blocks * BLOCK * 2);
  const voices = voicesOf(processor);
  const heldBefore = new Array<number>(voices.length);
  let hardKills = 0;
  let pending = 0;
  for (let k = 0; k < blocks; k++) {
    const b = firstBlock + k;
    loaded.setFrame(b * BLOCK);
    while (pending < events.length && events[pending]!.frame < (b + 1) * BLOCK) {
      processor.inbox(events[pending++]!);
    }
    voices.forEach((v, i) => (heldBefore[i] = v.active && !v.finished ? v.voiceId : NaN));
    processor.process([], [[left, right]], params);
    voices.forEach((v, i) => {
      if (v.active && heldBefore[i] === heldBefore[i] && v.voiceId !== heldBefore[i]) hardKills++;
    });
    for (let i = 0; i < BLOCK; i++) {
      samples[(k * BLOCK + i) * 2] = left[i]!;
      samples[(k * BLOCK + i) * 2 + 1] = right[i]!;
    }
  }
  return { samples, hardKills };
}

/** The largest second difference over frames [from, to), either channel. */
function largestCurve(samples: Float32Array, from: number, to: number): number {
  let largest = 0;
  for (let f = Math.max(from, 2); f < to; f++) {
    for (let c = 0; c < 2; c++) {
      const x0 = samples[f * 2 + c]!;
      const x1 = samples[(f - 1) * 2 + c]!;
      const x2 = samples[(f - 2) * 2 + c]!;
      largest = Math.max(largest, Math.abs(x0 - 2 * x1 + x2));
    }
  }
  return largest;
}

/** Each hit's sharpest curve over the pad's own, hits 1 to BARS - 1 (hit 0 has silence before it). */
function hitRatios(samples: Float32Array): number[] {
  const ratios: number[] = [];
  for (let bar = 1; bar < BARS; bar++) {
    const hit = bar * BAR_FRAMES;
    const after = largestCurve(samples, hit, hit + AFTER_HIT);
    const before = largestCurve(samples, hit - BEFORE_FROM, hit - BEFORE_TO);
    ratios.push(after / before);
  }
  return ratios;
}

function chordLoop(maxVoices: number, chord = C_MINOR): LoopResult {
  const processor = loaded.create(PAD, maxVoices);
  const blocks = (BARS * BAR_FRAMES) / BLOCK + Math.ceil(AFTER_HIT / BLOCK);
  return renderWatched(processor, blocks, chordEvents(chord, BARS));
}

describe('a chord pad at the music part limit (windsor#410)', () => {
  const twelve = chordLoop(MUSIC_LIMIT);
  const sixtyFour = chordLoop(64);

  it('plays a spread pad: two voices a note, so two hits of tails fill the part', () => {
    expect(PAD.spread).toBeGreaterThan(0);
  });

  it('moves the signal at a hit no more sharply than twice the pad’s own motion', () => {
    const ratios = hitRatios(twelve.samples);
    for (const ratio of ratios) expect(ratio).toBeLessThanOrEqual(MAX_HIT_RATIO);
    // The same loop with room for every tail, which never steals, for scale.
    for (const ratio of hitRatios(sixtyFour.samples))
      expect(ratio).toBeLessThanOrEqual(MAX_HIT_RATIO);
  });

  it('never cuts a voice: every steal fades', () => {
    expect(twelve.hardKills).toBe(0);
  });

  it('cuts no voice for an eight-note spread chord over a part full of tails', () => {
    const eight = [48, 51, 55, 58, 60, 63, 67, 70];
    expect(chordLoop(MUSIC_LIMIT, eight).hardKills).toBe(0);
  });
});

/* --- the stealing order --------------------------------------------- */

const LIMIT = 2;
/** A sine whose level follows velocity alone, with a long release. */
const tone = (): Patch =>
  makePatch({
    ops: [
      {
        level: 1,
        velSens: 1,
        env: { attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.8, releaseTime: 4 },
      },
    ],
  });

const on = (id: number, note: number, velocity: number, frame: number): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note,
  velocity,
  frame,
});
const off = (id: number, frame: number): ScheduledEvent => ({ type: 'noteOff', id, frame });

/** Render `blocks` from `firstBlock`, the part's clock carrying on from the last call. */
function play(
  processor: ProcessorLike,
  events: ScheduledEvent[],
  firstBlock: number,
  blocks: number,
) {
  renderWatched(processor, blocks, events, firstBlock);
}

const byId = (processor: ProcessorLike, id: number): StealVoice | undefined =>
  voicesOf(processor).find((v) => v.active && v.voiceId === id);

describe('which voice a full part steals (windsor#410)', () => {
  it('steals the quietest released voice, though an older released voice is louder', () => {
    const processor = loaded.create(tone(), LIMIT);
    // Loud and older, then quiet and younger: both released, both still sounding.
    play(processor, [on(1, 60, 1, 0), off(1, 4800), on(2, 64, 0.05, 6400), off(2, 9600)], 0, 100);
    const loud = byId(processor, 1);
    const quiet = byId(processor, 2);
    expect(loud?.gate).toBe(false);
    expect(quiet?.gate).toBe(false);
    expect(loud!.age).toBeGreaterThan(quiet!.age);

    play(processor, [on(3, 67, 1, 100 * BLOCK)], 100, 1);
    expect(quiet?.fading).toBe(true);
    expect(loud?.fading).toBe(false);
  });

  it('steals the oldest held voice when none is released', () => {
    const processor = loaded.create(tone(), LIMIT);
    play(processor, [on(1, 60, 0.05, 0), on(2, 64, 1, 4800)], 0, 50);
    const oldest = byId(processor, 1);
    const younger = byId(processor, 2);

    play(processor, [on(3, 67, 1, 50 * BLOCK)], 50, 1);
    expect(oldest?.fading).toBe(true);
    expect(younger?.fading).toBe(false);
  });

  it('fades a stolen voice over 30 ms, then frees it', () => {
    const processor = loaded.create(tone(), LIMIT);
    play(processor, [on(1, 60, 1, 0), on(2, 64, 1, 0)], 0, 50);
    const stolen = byId(processor, 1);
    // 30 ms is 1440 frames: still fading after 11 blocks (1408), gone after 12 (1536).
    play(processor, [on(3, 67, 1, 50 * BLOCK)], 50, 11);
    expect(stolen?.active && stolen.fading).toBe(true);
    play(processor, [], 61, 1);
    expect(stolen?.active).toBe(false);
  });

  it('still takes a dormant voice first, and kills it rather than fading it', () => {
    const pluck = makePatch({
      ops: [{ level: 1, env: { attackTime: 0.002, decayTime: 0.05, sustainLevel: 0 } }],
    });
    const processor = loaded.create(pluck, LIMIT);
    // The first goes dormant; the second is released and still decaying, so audible.
    play(processor, [on(1, 60, 1, 0)], 0, 150);
    const dormant = byId(processor, 1);
    expect(dormant?.dormant).toBe(true);
    play(processor, [on(2, 64, 1, 150 * BLOCK), off(2, 150 * BLOCK + 1)], 150, 2);

    play(processor, [on(3, 67, 1, 152 * BLOCK)], 152, 1);
    expect(voicesOf(processor).filter((v) => v.fading)).toHaveLength(0);
    expect(dormant?.voiceId).toBe(3);
  });
});
