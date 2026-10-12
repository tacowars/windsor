/**
 * A note-off that lands before its own queued note-on cancels it
 * (windsor#759). A ratchet's hits are posted at hit 0, each at its future
 * frame, the last an open note-on whose handle the part holds; a live edit
 * can then release that handle before the hit starts. The part used to apply
 * the note-off to no voice and then start the hit, which held forever. These
 * render through the shipped bundle: the cancelled note-on takes no voice and
 * renders nothing, a same-pitch note-on under another handle still plays, and
 * an ordinary note-off or one for an unknown handle renders as before, to the
 * bit.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;

/** The default patch: poly, sustain 0.7, a 0.3 s release. */
const PATCH = makePatch();
const NOTE = 60;
const VELOCITY = 0.9;
/** Long enough past a release for every tail to end. */
const TAIL_FRAMES = SR;

interface QueueVoice {
  active: boolean;
  gate: boolean;
  keyed: boolean;
  voiceId: number;
}

const voicesOf = (processor: ProcessorLike): QueueVoice[] =>
  processor.voices as unknown as QueueVoice[];

const on = (id: number, frame: number, note = NOTE): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note,
  velocity: VELOCITY,
  frame,
});
const off = (id: number, frame: number): ScheduledEvent => ({ type: 'noteOff', id, frame });

interface Span {
  /** Interleaved stereo. */
  samples: Float32Array;
  /** The largest number of active voices after any block. */
  mostActive: number;
}

/**
 * Render from `from` (a block boundary) up to `to`, one quantum at a time,
 * reading the voices after each block. Each `posts` entry is posted at the
 * block that starts at its key, as the port would deliver it ahead.
 */
function renderSpan(
  processor: ProcessorLike,
  from: number,
  to: number,
  posts: Map<number, ScheduledEvent[]> = new Map(),
): Span {
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const params = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const samples = new Float32Array((to - from) * 2);
  let mostActive = 0;
  for (let start = from; start < to; start += BLOCK) {
    for (const event of posts.get(start) ?? []) processor.inbox(event);
    loaded.setFrame(start);
    processor.process([], [[left, right]], params);
    for (let i = 0; i < BLOCK; i++) {
      samples[(start - from + i) * 2] = left[i]!;
      samples[(start - from + i) * 2 + 1] = right[i]!;
    }
    const active = voicesOf(processor).filter((v) => v.active).length;
    mostActive = Math.max(mostActive, active);
  }
  return { samples, mostActive };
}

const peakOf = (samples: Float32Array): number =>
  samples.reduce((peak, s) => Math.max(peak, Math.abs(s)), 0);

const sounding = (processor: ProcessorLike, id: number): boolean =>
  voicesOf(processor).some((v) => v.active && v.keyed && v.voiceId === id);

describe('a note-off that lands before its queued note-on (windsor#759)', () => {
  it('cancels the note-on: no voice is taken and nothing renders', () => {
    const processor = loaded.create(PATCH);
    const posts = new Map([[0, [on(1, 20 * BLOCK + 17), off(1, 6 * BLOCK + 5)]]]);
    const span = renderSpan(processor, 0, 20 * BLOCK + TAIL_FRAMES, posts);
    expect(span.mostActive).toBe(0);
    expect(peakOf(span.samples)).toBe(0);
  });

  it('cancels a ×4 ratchet’s last hit when its pitch is released between hit 2 and hit 3', () => {
    const processor = loaded.create(PATCH);
    const step = 40 * BLOCK;
    const gate = 20 * BLOCK;
    // Hits 0 to 2 closed, hit 3 open: all posted at hit 0, as `playPitched` does.
    const ratchet: ScheduledEvent[] = [];
    for (let hit = 0; hit < 3; hit++) {
      ratchet.push(on(hit + 1, hit * step), off(hit + 1, hit * step + gate));
    }
    ratchet.push(on(4, 3 * step));
    const editAt = 2 * step + gate + 4 * BLOCK;
    // `noteOffByNote` at the edit: the held handle for the pitch is hit 3's.
    const posts = new Map([
      [0, ratchet],
      [editAt, [off(4, editAt + 3)]],
    ]);
    const end = 3 * step + TAIL_FRAMES;
    const before = renderSpan(processor, 0, 3 * step, posts);
    expect(before.mostActive).toBeGreaterThan(0);
    const after = renderSpan(processor, 3 * step, end);
    expect(sounding(processor, 4)).toBe(false);
    expect(voicesOf(processor).some((v) => v.active)).toBe(false);
    const lastBlock = after.samples.subarray(after.samples.length - BLOCK * 2);
    expect(peakOf(lastBlock)).toBe(0);
  });

  it('drops only the cancelled handle of two queued note-ons of one pitch', () => {
    const processor = loaded.create(PATCH);
    const first = 10 * BLOCK;
    const second = 20 * BLOCK;
    const firstOff = 30 * BLOCK;
    const posts = new Map([
      [0, [on(1, first), on(2, second), off(2, 5 * BLOCK), off(1, firstOff)]],
    ]);
    const lead = renderSpan(processor, 0, first, posts);
    expect(peakOf(lead.samples)).toBe(0);
    renderSpan(processor, first, second + BLOCK);
    expect(sounding(processor, 1)).toBe(true);
    expect(sounding(processor, 2)).toBe(false);
    const held = renderSpan(processor, second + BLOCK, firstOff);
    expect(held.mostActive).toBe(1);
    renderSpan(processor, firstOff, firstOff + TAIL_FRAMES);
    expect(voicesOf(processor).some((v) => v.active)).toBe(false);
  });
});

describe('a note-off that finds its voice or no queued note-on (windsor#759)', () => {
  const NOTE_OFF = 30 * BLOCK + 9;
  const END = 31 * BLOCK + TAIL_FRAMES;

  it('releases a sounding note as before', () => {
    const processor = loaded.create(PATCH);
    const posts = new Map([[0, [on(1, 3), off(1, NOTE_OFF)]]]);
    renderSpan(processor, 0, NOTE_OFF - 9, posts);
    expect(sounding(processor, 1)).toBe(true);
    renderSpan(processor, NOTE_OFF - 9, NOTE_OFF - 9 + 2 * BLOCK);
    const voice = voicesOf(processor).find((v) => v.active && v.voiceId === 1);
    expect(voice?.gate).toBe(false);
    expect(voice?.keyed).toBe(false);
  });

  it('leaves the render bit for bit unchanged for a note-off of an unknown handle', () => {
    const plain = new Map([[0, [on(1, 3), on(2, 50 * BLOCK, 64), off(1, NOTE_OFF)]]]);
    const stray = new Map([
      [0, [on(1, 3), on(2, 50 * BLOCK, 64), off(1, NOTE_OFF)]],
      [10 * BLOCK, [off(99, 10 * BLOCK + 1)]],
      [40 * BLOCK, [off(1, 40 * BLOCK + 2)]],
    ]);
    const a = renderSpan(loaded.create(PATCH), 0, END, plain);
    const b = renderSpan(loaded.create(PATCH), 0, END, stray);
    expect(peakOf(a.samples)).toBeGreaterThan(0);
    expect(Buffer.from(b.samples.buffer).equals(Buffer.from(a.samples.buffer))).toBe(true);
  });
});
