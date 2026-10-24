/**
 * A Drum part through the player (windsor#948, record
 * `2026-10-24-drum-sequencer` decisions 4, 6 and 7): its hits on the part's
 * patch, the gate's release and a ratchet's roll across the swung step, the
 * `seq.*` lanes it offers, a region's own pattern, and its playhead.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { SEQ_AUTOMATION_FIELDS } from '../automation/automationSeqTables';
import { DEFAULT_DRUM_CONFIG } from '../sequencing/drumSequencer';
import { DRUM_REST, drumHit, type DrumStep } from '../sequencing/drumSteps';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import type { Arrangement, DrumSpec, PartRegion, Transport } from './arrangement';

const BPM = 120;
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;
const SIXTEENTH = DIVISORS.sixteenth;
const BAR = TICKS_PER_BAR;
const VELOCITY = 0.8;

/** `spec` without its seed, as a region pattern or a rack carries it. */
function withoutSeed<T extends { seed: number }>(spec: T): Omit<T, 'seed'> {
  const copy: Partial<T> = { ...spec };
  delete copy.seed;
  return copy as Omit<T, 'seed'>;
}

function song(
  over: Partial<DrumSpec> = {},
  regions?: readonly PartRegion[],
  transport?: Partial<Transport>,
): Arrangement {
  const sequencer: DrumSpec = { kind: 'drum', ...DEFAULT_DRUM_CONFIG, ...over };
  const base = {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM, ...transport },
  };
  return withPart(base, 'kick', {
    sequencer,
    velocity: VELOCITY,
    ...(regions ? { regions } : {}),
  });
}

function play(arrangement: Arrangement, bars = 1): Call[] {
  const r = rig(arrangement);
  r.run(bars);
  return r.parts.kick.calls;
}

/** A call as `[kind, start tick, held ticks]`, ticks rounded to a thousandth. */
const at = (c: Call): [string, number, number | undefined] => [
  c.kind,
  Math.round(((c.time ?? 0) / TICK) * 1000) / 1000,
  c.duration === undefined ? undefined : Math.round((c.duration / TICK) * 1000) / 1000,
];
const line = (written: Record<number, DrumStep>): DrumStep[] =>
  Array.from({ length: 16 }, (_, i) => written[i] ?? DRUM_REST);

describe('a new Drum part', () => {
  it('plays note 60 on steps 0, 4, 8 and 12 at the part’s velocity, each released at half its step', () => {
    const calls = play(song());
    expect(calls.map(at)).toEqual(
      [0, 24, 48, 72].flatMap((t) => [
        ['noteOn', t, undefined],
        ['noteOffByNote', t + 3, undefined],
      ]),
    );
    const on = calls.filter((c) => c.kind === 'noteOn');
    expect(on.every((c) => c.note === 60 && c.velocity === VELOCITY && !c.extras)).toBe(true);
  });
});

describe('a hit’s velocity and accent', () => {
  it('scales the part’s velocity; 0 plays silent; an accent adds its bump and sends its mod', () => {
    const steps = line({
      0: drumHit({ velocity: 0.5 }),
      4: drumHit({ velocity: 0 }),
      8: drumHit({ velocity: 0.5, accent: true }),
    });
    const on = play(song({ steps, accentVelocity: 0.2, accentMod: 0.6 })).filter(
      (c) => c.kind === 'noteOn',
    );
    expect(on[0]?.velocity).toBeCloseTo(0.4, 12);
    expect(on[1]?.velocity).toBe(0);
    expect(on[2]?.velocity).toBeCloseTo(0.6, 12);
    expect(on[2]?.extras).toMatchObject({ mod: 0.6, slide: false });
  });
});

describe('a ratchet', () => {
  for (const hits of [2, 3, 4]) {
    it(`of ${hits} plays ${hits} hits evenly over the step, each held gate × span / n, straight and swung`, () => {
      const steps = line({ 0: drumHit({ ratchet: hits }), 1: drumHit({ ratchet: hits }) });
      const straight = play(song({ steps, gate: 0.5 }));
      const expected = [0, 1].flatMap((step) =>
        Array.from({ length: hits }, (_, j) => [
          'trigger',
          Math.round((step * SIXTEENTH + (j * SIXTEENTH) / hits) * 1000) / 1000,
          Math.round(((0.5 * SIXTEENTH) / hits) * 1000) / 1000,
        ]),
      );
      expect(straight.map(at)).toEqual(expected);

      // At 60% on 16ths the first sixteenth lasts 7.2 ticks and the second 4.8.
      const swung = play(song({ steps, gate: 1 }, undefined, { swing: { amount: 60, grid: 16 } }));
      const spans = [7.2, 4.8];
      const starts = [0, 7.2];
      const expectedSwung = [0, 1].flatMap((step) =>
        Array.from({ length: hits }, (_, j) => [
          'trigger',
          Math.round((starts[step]! + (j * spans[step]!) / hits) * 1000) / 1000,
          Math.round((spans[step]! / hits) * 1000) / 1000,
        ]),
      );
      expect(swung.map(at)).toEqual(expectedSwung);
    });
  }
});

describe('the gate', () => {
  it('at 1 the note-off lands on the next step’s tick, before its hit', () => {
    const steps = line({ 0: drumHit(), 1: drumHit() });
    expect(play(song({ steps, gate: 1 })).map(at)).toEqual([
      ['noteOn', 0, undefined],
      ['noteOffByNote', SIXTEENTH, undefined],
      ['noteOn', SIXTEENTH, undefined],
      ['noteOffByNote', 2 * SIXTEENTH, undefined],
    ]);
  });

  it('a region end inside the gate releases there', () => {
    const calls = play(song({ gate: 1 }, [{ start: 0, duration: 2 }]));
    expect(calls.map(at)).toEqual([
      ['noteOn', 0, undefined],
      ['noteOffByNote', 2, undefined],
    ]);
  });
});

describe('the lanes a Drum offers', () => {
  it('are Gate, Randomness and Probability; the Grid still offers no gate', () => {
    expect(SEQ_AUTOMATION_FIELDS.drum).toEqual(['gate', 'randomness', 'probability']);
    expect(SEQ_AUTOMATION_FIELDS.grid).not.toContain('gate');
  });

  it('a `seq.gate` lane moves the gate read on the step', () => {
    const lane = {
      target: 'seq.gate',
      on: true,
      points: [{ tick: 0, value: 1 }],
    };
    const arrangement = song({ gate: 0.5 });
    const laned = {
      ...arrangement,
      parts: arrangement.parts.map((p) => (p.slot === 0 ? { ...p, automation: [lane] } : p)),
    } as Arrangement;
    const offs = play(laned).filter((c) => c.kind === 'noteOffByNote');
    expect(offs.map(at).map(([, tick]) => tick)).toEqual([6, 30, 54, 78]);
  });
});

describe('regions', () => {
  it('a region’s own Drum pattern plays in place of the part’s', () => {
    const pattern = withoutSeed({ kind: 'drum' as const, ...DEFAULT_DRUM_CONFIG });
    const regions: PartRegion[] = [
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR, pattern: { ...pattern, note: 48 } },
    ];
    const notes = play(song({}, regions), 2)
      .filter((c) => c.kind === 'noteOn')
      .map((c) => [Math.round((c.time ?? 0) / TICK), c.note]);
    expect(notes).toEqual([
      [0, 60],
      [24, 60],
      [48, 60],
      [72, 60],
      [96, 48],
      [120, 48],
      [144, 48],
      [168, 48],
    ]);
  });

  it('re-entering a region restarts the count: a 3-step loop starts over at each region', () => {
    const steps = line({
      0: drumHit({ pitch: 1 }),
      1: drumHit({ pitch: 2 }),
      2: drumHit({ pitch: 3 }),
    });
    const regions = [
      { start: 0, duration: 4 * SIXTEENTH },
      { start: BAR, duration: 4 * SIXTEENTH },
    ];
    const notes = play(song({ steps, length: 3 }, regions), 2)
      .filter((c) => c.kind === 'noteOn')
      .map((c) => c.note);
    expect(notes).toEqual([61, 62, 63, 61, 61, 62, 63, 61]);
  });

  it('re-entering restarts the variation stream', () => {
    const regions = [
      { start: 0, duration: BAR },
      { start: BAR, duration: BAR },
    ];
    const over = { randomness: 1, probability: 1, seed: 4 };
    const r = rig(song(over, regions));
    r.run(2);
    const offsets = (from: number) =>
      r.parts.kick.calls
        .filter(
          (c) =>
            c.kind === 'noteOn' &&
            (c.time ?? 0) / TICK >= from &&
            (c.time ?? 0) / TICK < from + BAR,
        )
        .map((c) => c.velocity);
    // Region 1's stream is `hashSeed(seed, 1)`, not region 0's carried on: the two bars differ,
    // and a second run replays both.
    expect(offsets(0)).not.toEqual(offsets(BAR));
    const again = rig(song(over, regions));
    again.run(2);
    expect(again.parts.kick.calls).toEqual(r.parts.kick.calls);
  });

  it('stepAt and regionStepAt report the local step mod the length', () => {
    const r = rig(song({ length: 5 }));
    const slot = 0;
    for (const tick of [0, 6, 29, 30, 95]) {
      const step = Math.floor(tick / SIXTEENTH) % 5;
      expect(r.player.stepAt(slot, tick), `tick ${tick}`).toBe(step);
      expect(r.player.regionStepAt(slot, 0, tick)).toEqual({ step, live: true });
    }
  });
});
