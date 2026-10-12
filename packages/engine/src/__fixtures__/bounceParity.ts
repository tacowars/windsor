/**
 * Bounce to Roll's parity rig (windsor#755, record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 11): a region played
 * by `ArrangementPlayer` as the generator plays it, and again after the
 * part is bounced to Roll, each reduced to what sounded, so a test can
 * hold the two side by side, accents and ratchets included.
 *
 * What sounded is one hit per note-on (`noteOn` or `trigger`): its time,
 * pitch, level, accent mod and slide, and when it stopped sounding. That
 * is its own release (a `trigger`'s hold, or the note-off of its pitch), or
 * on a mono patch the next onset after it, which cut it or slid out of it.
 * So a slid-from note the bounce lengthens one tick into the slide, and a
 * note it trims where a mono patch cut it, sound as the generator's did.
 */
import { expect } from 'vitest';

import { PRESETS } from '../patch/presets';
import type { MusicPart, SequencerSpec } from '../song/arrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { presetFor } from '../song/arrangementValidate';
import { bounceToRoll } from '../song/bounceToRoll';
import type { BounceResult } from '../song/bounceToRollTypes';
import { BOUNCE_SLOT, playRegion, type BounceSong } from './bounceRig';
import { applyBounce, bounceDocument } from './bounceToRollRig';
import type { Call } from './recordingPart';

/** One note-on as it sounded. Times in seconds. */
export interface Sounded {
  readonly time: number;
  readonly end: number;
  readonly note: number;
  readonly velocity: number;
  readonly mod: number;
  readonly slide: boolean;
}

type Open = { -readonly [K in keyof Sounded]: Sounded[K] };

/** `calls` as the hits they sounded, a hit never released ending at `leave`. */
export function sounded(calls: readonly Call[], mono: boolean, leave: number): Sounded[] {
  const hits: Open[] = [];
  const held = new Map<number, Open[]>();
  for (const call of calls) {
    const note = call.note!;
    if (call.kind === 'noteOffByNote') {
      for (const hit of held.get(note) ?? []) hit.end = Math.min(hit.end, call.time!);
      held.delete(note);
      continue;
    }
    if (call.kind !== 'noteOn' && call.kind !== 'trigger') continue;
    const time = call.time!;
    const end = call.kind === 'trigger' ? time + call.duration! : leave;
    const hit = {
      time,
      end,
      note,
      velocity: call.velocity!,
      mod: call.extras?.mod ?? 0,
      slide: call.extras?.slide === true,
    };
    hits.push(hit);
    if (call.kind === 'noteOn') held.set(note, [...(held.get(note) ?? []), hit]);
  }
  hits.sort((a, b) => a.time - b.time || a.note - b.note);
  if (mono) hits.forEach((hit, i) => (hit.end = Math.min(hit.end, nextOnset(hits, i))));
  return hits;
}

/** The first onset after hit `i`'s, or Infinity. */
function nextOnset(hits: readonly Sounded[], i: number): number {
  const time = hits[i]!.time;
  return hits.find((hit) => hit.time > time)?.time ?? Infinity;
}

export interface BothPlays {
  /** The generated part's region, as it sounded. */
  readonly generated: readonly Sounded[];
  /** The bounced Roll part's region, as it sounded. */
  readonly bounced: readonly Sounded[];
  readonly result: BounceResult;
  /** The bounced part, as the song then holds it. */
  readonly part: MusicPart;
}

/**
 * Region `index` of the rig's part playing `sequencer`, played before and
 * after the bounce, on its patch's mono or poly rule.
 */
export function playBoth(sequencer: SequencerSpec, over: BounceSong = {}, index = 0): BothPlays {
  const { mono } = presetFor(PRESETS, 'parity', over.preset ?? 'saw-arp');
  const doc = bounceDocument(sequencer, over);
  const result = bounceToRoll(doc, BOUNCE_SLOT);
  const after: ArrangementDocument = applyBounce(doc, result).normalised.document;
  const play = (song: ArrangementDocument): Sounded[] => {
    const { calls, transport } = playRegion(song, index);
    const region = song.parts.find((p) => p.slot === BOUNCE_SLOT)!.regions[index]!;
    const leave = transport.swungTicks(region.start + region.duration) * transport.secondsPerTick;
    return sounded(calls, mono, leave);
  };
  const part = after.parts.find((p) => p.slot === BOUNCE_SLOT)! as MusicPart;
  return { generated: play(doc), bounced: play(after), result, part };
}

/** Digits a time or a level must agree to: float noise from summing the clock's seconds. */
const DIGITS = 9;

/** The bounced region sounded as the generated one did: every hit, its times, level, mod and slide. */
export function expectSameSound({ generated, bounced }: BothPlays): void {
  expect(generated.length).toBeGreaterThan(0);
  expect(bounced).toHaveLength(generated.length);
  generated.forEach((hit, i) => {
    const after = bounced[i]!;
    const at = `hit ${i} at ${hit.time.toFixed(4)} s`;
    expect(after.note, at).toBe(hit.note);
    expect(after.time, at).toBeCloseTo(hit.time, DIGITS);
    expect(after.end, at).toBeCloseTo(hit.end, DIGITS);
    expect(after.velocity, at).toBeCloseTo(hit.velocity, DIGITS);
    expect(after.mod, at).toBe(hit.mod);
    expect(after.slide, at).toBe(hit.slide);
  });
}
