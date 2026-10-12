/**
 * A Roll note's accent and ratchet through the player (windsor#753, record
 * `2026-10-12-roll-note-accent-and-ratchet`), on the fixture's drone part
 * played as a Roll: an accent bumps the part's velocity and sends its mod
 * on every hit; a ratchet of N plays N hits evenly in seconds from the
 * note's onset to its release, straight and under swing; hit 0 slides, the
 * later hits do not, and the last hit still slides into an overlapping
 * note; and a region end inside the note drops the hits past it.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  onlyParts,
  withPart,
} from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { RollNote, RollSequencerConfig } from '../sequencing/rollSequencer';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { PartRegion, Transport } from './arrangement';

const BAR = TICKS_PER_BAR;
const VELOCITY = FULL_PARTS.drone.velocity;
const BPM = 120;
/** Seconds per straight tick at `BPM`. */
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;

interface RollSong {
  readonly roll?: Partial<RollSequencerConfig>;
  readonly regions?: readonly PartRegion[];
  readonly transport?: Partial<Transport>;
}

/** The drone part alone as a Roll of `notes`, one bar long, at `BPM`, played for `bars`; its calls. */
function play(notes: RollNote[], over: RollSong = {}, bars = 1): Call[] {
  const regions = over.regions ?? [{ start: 0, duration: 4 * BAR }];
  const base = {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM, ...over.transport },
  };
  const sequencer = { kind: 'roll' as const, loopTicks: BAR, notes, ...over.roll };
  const r = rig(onlyParts(withPart(base, 'drone', { regions, sequencer }), 'drone'));
  r.run(bars);
  return r.parts.drone.calls;
}

const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((c) => c.kind === 'noteOn' || c.kind === 'trigger');

const offs = (calls: readonly Call[]): Call[] => calls.filter((c) => c.kind === 'noteOffByNote');

/**
 * The hits of the ratcheted `pitch` and the release that ends its last: N
 * starts, each closed hit held to the next, the last open and released.
 */
function expectEvenRoll(calls: readonly Call[], pitch: number, hits: number): void {
  const roll = sounding(calls).filter((c) => c.note === pitch);
  const release = offs(calls).find((c) => c.note === pitch);
  expect(roll).toHaveLength(hits);
  const start = roll[0]!.time!;
  const span = release!.time! - start;
  roll.forEach((hit, j) => {
    expect(hit.time, `hit ${j}`).toBeCloseTo(start + (j * span) / hits, 12);
    if (j < hits - 1) {
      expect(hit.kind).toBe('trigger');
      expect(hit.duration, `hit ${j} held to the next`).toBeCloseTo(span / hits, 12);
    } else {
      expect(hit.kind).toBe('noteOn');
    }
  });
}

describe('a Roll accent through the player (windsor#753)', () => {
  it("bumps the part's velocity over the note's own and sends the mod, on every hit", () => {
    const notes: RollNote[] = [
      { tick: 0, ticks: 24, pitch: 60, velocity: 0.5, accent: true, ratchet: 2 },
    ];
    const calls = play(notes, { roll: { accentVelocity: 0.3, accentMod: 0.25 } });
    const hits = sounding(calls);
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.velocity).toBeCloseTo(VELOCITY * 0.5 + 0.3, 12);
      expect(hit.extras).toEqual({ mod: 0.25, slide: false });
    }
  });

  it("plays the Grid's default amounts when the roll names none, at most 1", () => {
    const calls = play([{ tick: 0, ticks: 24, pitch: 60, accent: true }]);
    expect(sounding(calls)).toEqual([
      { kind: 'noteOn', note: 60, velocity: 1, time: 0, extras: { mod: 1, slide: false } },
    ]);
  });
});

describe('a Roll ratchet through the player (windsor#753)', () => {
  it.each([2, 4])('×%i straight: the hits divide the note evenly in seconds', (hits) => {
    const calls = play([{ tick: 6, ticks: 18, pitch: 60, ratchet: hits }]);
    expectEvenRoll(calls, 60, hits);
    const span = offs(calls)[0]!.time! - sounding(calls)[0]!.time!;
    expect(span).toBeCloseTo(18 * TICK, 12);
  });

  it.each([2, 4])('×%i under 75%% swing: the hits divide the swung span evenly', (hits) => {
    const transport = { swing: { amount: 75, grid: 16 as const } };
    // From the off-beat sixteenth at tick 6 to the next beat: a squeezed span.
    const calls = play([{ tick: 6, ticks: 18, pitch: 60, ratchet: hits }], { transport });
    expectEvenRoll(calls, 60, hits);
    const span = offs(calls)[0]!.time! - sounding(calls)[0]!.time!;
    expect(span).not.toBeCloseTo(18 * TICK, 4);
  });

  it('slides from its last hit into an overlapping note of another pitch', () => {
    const calls = play([
      { tick: 0, ticks: 24, pitch: 60, ratchet: 2 },
      { tick: 18, ticks: 12, pitch: 64 },
    ]);
    const into = calls.find((c) => c.note === 64);
    expect(into).toMatchObject({ kind: 'noteOn', extras: { mod: 0, slide: true } });
    // The open last hit is still sounding when the slide takes its voice.
    const last = sounding(calls)
      .filter((c) => c.note === 60)
      .at(-1)!;
    expect(last.kind).toBe('noteOn');
    expect(last.time!).toBeLessThan(into!.time!);
    expect(calls.indexOf(into!)).toBeLessThan(calls.indexOf(offs(calls)[0]!));
  });

  it('slides on hit 0 while another pitch is held; its later hits retrigger without the slide', () => {
    const calls = play([
      { tick: 0, ticks: 18, pitch: 55 },
      { tick: 12, ticks: 24, pitch: 60, ratchet: 3 },
    ]);
    const roll = sounding(calls).filter((c) => c.note === 60);
    expect(roll.map((c) => c.extras)).toEqual([{ mod: 0, slide: true }, undefined, undefined]);
    expectEvenRoll(calls, 60, 3);
  });

  it('drops the hits past a region end inside the note, as a Grid roll does', () => {
    // The region ends 9 ticks into a 24-tick ×4 note: hits at 0 and 6 sound, 12 and 18 do not.
    const regions = [{ start: 0, duration: 9 }];
    const calls = play([{ tick: 0, ticks: 24, pitch: 60, ratchet: 4 }], { regions });
    expect(
      calls.map((c) => [
        c.kind,
        Math.round((c.time ?? 0) / TICK),
        c.duration === undefined ? undefined : Math.round(c.duration / TICK),
      ]),
    ).toEqual([
      ['trigger', 0, 6],
      ['noteOn', 6, undefined],
      ['noteOffByNote', 9, undefined],
    ]);
  });
});

describe("a live edit of a Roll's accent amounts (windsor#753)", () => {
  it('reaches a roll that names none, and the next accent plays it', () => {
    const base = { ...FULL_ARRANGEMENT, transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM } };
    const notes: RollNote[] = [{ tick: 0, ticks: 24, pitch: 60, velocity: 0.5, accent: true }];
    const sequencer = { kind: 'roll' as const, loopTicks: BAR, notes };
    const regions = [{ start: 0, duration: 4 * BAR }];
    const r = rig(onlyParts(withPart(base, 'drone', { regions, sequencer }), 'drone'));
    const roll = { kind: 'roll' as const, accentVelocity: 0.4, accentMod: 0.5 };
    const result = r.player.apply({ parts: { [FULL_SLOT.drone]: { sequencer: roll } } });
    expect(result.ok).toBe(true);
    expect(result.ignored).toEqual([]);
    r.run(1);
    const [hit] = sounding(r.parts.drone.calls);
    expect(hit!.velocity).toBeCloseTo(VELOCITY * 0.5 + 0.4, 12);
    expect(hit!.extras).toEqual({ mod: 0.5, slide: false });
  });
});

describe('a live edit that makes a chord of a marked Roll note (windsor#753)', () => {
  it('plays the chord plain, as the normalised song will', () => {
    const base = { ...FULL_ARRANGEMENT, transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM } };
    const marked: RollNote = { tick: 0, ticks: 12, pitch: 60, accent: true, ratchet: 4 };
    const sequencer = {
      kind: 'roll' as const,
      loopTicks: BAR,
      notes: [marked, { tick: 24, ticks: 12, pitch: 64 }],
    };
    const regions = [{ start: 0, duration: 4 * BAR }];
    const r = rig(onlyParts(withPart(base, 'drone', { regions, sequencer }), 'drone'));
    // The plain note dragged onto the marked one's onset: the app sends the array as it is.
    const notes: RollNote[] = [marked, { tick: 0, ticks: 12, pitch: 64 }];
    const result = r.player.apply({
      parts: { [FULL_SLOT.drone]: { sequencer: { kind: 'roll', notes } } },
    });
    expect(result.ok).toBe(true);
    r.run(1);
    const played = sounding(r.parts.drone.calls);
    expect(played.map((c) => c.note).sort()).toEqual([60, 64]);
    for (const hit of played) expect(hit.velocity).toBeCloseTo(VELOCITY, 12);
  });
});
