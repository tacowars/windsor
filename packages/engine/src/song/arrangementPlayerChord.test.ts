/**
 * The binding layer for a chord part (#606, #705): every voiced note reaches the
 * part at the event time with the part velocity, the chord is the harmony
 * timeline's at the hit's tick, a key change re-voices the
 * progression live, edits reconfigure without an all-notes-off, a bad edit is
 * refused whole, a stop releases the held chord, and capture does not apply.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_SLOT,
  slotMap,
  type FullPartId,
} from '../__fixtures__/fullArrangement';
import { recordingPart, type RecordingPart } from '../__fixtures__/recordingPart';
import type { Arrangement, MusicPart } from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';
import { DEFAULT_CHORD_CONFIG, hitStep, restStep } from '../sequencing/chordSequencer';
import { PRESETS } from '../patch/presets';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';

const { arp, drone } = FULL_SLOT;

/**
 * The fixture's drone slot driven by a rhythm in C minor over i for two bars
 * and VI for two (#705: the chord is the harmony's): a hit, a rest, then two
 * half-bar hits — i, a rest, then VI twice.
 */
const PROGRESSION: Arrangement = {
  ...FULL_ARRANGEMENT,
  harmony: {
    root: 0,
    scale: 'naturalMinor',
    events: [
      { start: 0, duration: 2 * TICKS_PER_BAR, degree: 0, size: 3 },
      { start: 2 * TICKS_PER_BAR, duration: 2 * TICKS_PER_BAR, degree: 5, size: 3 },
    ],
  },
  parts: FULL_ARRANGEMENT.parts.map((part): MusicPart =>
    part.slot === drone
      ? {
          ...part,
          velocity: 0.6,
          sequencer: {
            kind: 'chord',
            divisor: DIVISORS.bar,
            gate: 1,
            voicing: 'close',
            // C3 = 48.
            register: { octave: 3 },
            steps: [hitStep(), restStep(), hitStep({ duration: 0.5, repeat: 2 })],
          },
        }
      : part,
  ),
};

function rig(arrangement: Arrangement): {
  transport: TickTransport;
  parts: Record<FullPartId, RecordingPart>;
  player: ArrangementPlayer;
  run(bars: number): void;
} {
  const transport = new TickTransport(120);
  const parts: Record<FullPartId, RecordingPart> = {
    kick: recordingPart(),
    hat: recordingPart(),
    arp: recordingPart(),
    drone: recordingPart(),
  };
  const player = new ArrangementPlayer(transport, slotMap(parts), arrangement, PRESETS);
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, parts, player, run };
}

const noteOns = (part: RecordingPart): number[] =>
  part.calls.filter((c) => c.kind === 'noteOn').map((c) => c.note ?? -1);

describe('chord parts (#606)', () => {
  it('sends every voiced note at the event time with the part velocity', () => {
    const { parts, run, transport } = rig(PROGRESSION);
    run(3);
    const ons = parts.drone.calls.filter((c) => c.kind === 'noteOn');
    // Bar 1: C minor; bar 2: rest; bar 3: G# major twice.
    expect(ons.map((c) => c.note)).toEqual([48, 51, 55, 56, 60, 63, 56, 60, 63]);
    expect(ons.every((c) => c.velocity === 0.6 && c.extras === undefined)).toBe(true);
    expect(ons[3]?.time).toBeCloseTo(2 * TICKS_PER_BAR * transport.secondsPerTick, 9);
    // The rest released the C minor chord at the bar line, one off per note.
    const offs = parts.drone.calls.filter((c) => c.kind === 'noteOffByNote');
    expect(offs.slice(0, 3).map((c) => c.note)).toEqual([48, 51, 55]);
  });

  it('a scale or root change re-voices the next onset live, without an all-notes-off', () => {
    const { parts, player, run } = rig(PROGRESSION);
    run(1);
    const before = parts.drone.calls.length;
    expect(player.apply({ harmony: { root: 2, scale: 'major' } }, {}).ok).toBe(true);
    run(2);
    const since = parts.drone.calls.slice(before);
    expect(since.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    // Degree 5 of D major is B minor.
    expect(
      since
        .filter((c) => c.kind === 'noteOn')
        .map((c) => c.note)
        .slice(0, 3),
    ).toEqual([59, 62, 66]);
  });

  it('a step, voicing, gate or divisor edit reconfigures live: no all-notes-off, no restart', () => {
    const { parts, player, run } = rig(PROGRESSION);
    run(1);
    const before = parts.drone.calls.length;
    expect(player.apply({ parts: { [drone]: { sequencer: { voicing: 'drop2' } } } }, {}).ok).toBe(
      true,
    );
    expect(player.apply({ parts: { [drone]: { sequencer: { gate: 0.5 } } } }, {}).ok).toBe(true);
    expect(
      player.apply({ parts: { [drone]: { sequencer: { divisor: DIVISORS.half } } } }, {}).ok,
    ).toBe(true);
    // #705: the chord is the harmony's, so the seventh on iv is a harmony edit — live, no rebuild.
    const events = [{ start: 0, duration: 4 * TICKS_PER_BAR, degree: 3, size: 4 as const }];
    expect(player.apply({ harmony: { events } }, {}).ok).toBe(true);
    const steps = [hitStep()];
    expect(player.apply({ parts: { [drone]: { sequencer: { steps } } } }, {}).ok).toBe(true);
    expect(parts.drone.calls.slice(before).filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    run(1);
    const since = parts.drone.calls.slice(before);
    // The held C minor goes at the new pattern's first onset (tick 96, its length is 48),
    // then F minor 7 in drop2 (C3 F3 G#3 D#4) every half bar.
    expect(since.slice(0, 3).map((c) => c.kind)).toEqual([
      'noteOffByNote',
      'noteOffByNote',
      'noteOffByNote',
    ]);
    expect(noteOns(parts.drone).slice(3, 7)).toEqual([48, 53, 56, 63]);
  });

  it('an invalid live edit is refused whole: no tempo, no arrangement, no generator change', () => {
    const { parts, player, run } = rig(PROGRESSION);
    run(1);
    const before = parts.drone.calls.length;
    const result = player.apply(
      {
        transport: { bpm: 140 },
        parts: { [drone]: { sequencer: { steps: [hitStep({ repeat: 9 })] } } },
      },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/repeat/);
    expect(player.readout().bpm).toBe(PROGRESSION.transport.bpm);
    const junk = player.apply(
      {
        transport: { bpm: 140 },
        parts: { [drone]: { sequencer: { register: { octave: Number.NaN } } } },
      },
      {},
    );
    expect(junk.ok).toBe(false);
    expect(junk.error).toMatch(/register/);
    expect(player.readout().bpm).toBe(PROGRESSION.transport.bpm);
    run(2);
    expect(noteOns(parts.drone).slice(3, 6)).toEqual([56, 60, 63]);
    expect(parts.drone.calls.slice(before).filter((c) => c.kind === 'allNotesOff')).toEqual([]);
  });

  it('a transport stop releases the held chord, and capture does not apply', () => {
    const { parts, player, run } = rig(PROGRESSION);
    run(1);
    expect(player.capturePattern(drone)).toBeNull();
    player.releaseAll();
    const tail = parts.drone.calls.slice(-4);
    expect(tail.map((c) => c.kind)).toEqual([
      'noteOffByNote',
      'noteOffByNote',
      'noteOffByNote',
      'allNotesOff',
    ]);
  });

  it('a kind change to chord builds a silent part until a step is written', () => {
    // The fixture's grid slot (its drone is already a Chord Player since #705).
    const { parts, player, run } = rig(FULL_ARRANGEMENT);
    // A kind change replaces the spec wholesale, so it arrives complete (the console rebuilds for it).
    const blank = { ...DEFAULT_CHORD_CONFIG };
    expect(
      player.apply({ parts: { [arp]: { sequencer: { kind: 'chord', ...blank } } } }, {}).ok,
    ).toBe(true);
    const before = parts.arp.calls.length;
    run(2);
    expect(parts.arp.calls.slice(before)).toEqual([]);
    expect(player.apply({ parts: { [arp]: { sequencer: { steps: [hitStep()] } } } }, {}).ok).toBe(
      true,
    );
    run(1);
    // Bar 3 of the fixture is iv in D dorian (G B D), voiced above D3 = 50 at the default register.
    expect(noteOns(parts.arp).slice(-3)).toEqual([50 + 5, 50 + 9, 50 + 12]);
  });
});
