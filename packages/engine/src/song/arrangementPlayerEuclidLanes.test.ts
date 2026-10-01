/**
 * A Euclid part's drawn lanes through the player (windsor#355): a song
 * without them plays exactly the hits it did, and with them each hit takes
 * its accent, pitch and offsets from every lane at its own length, the lanes
 * restarting where the trigger does. The pure read is `euclidLanes.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_ON,
  KICK_SLOT,
  KICK_SPEC,
  figure,
  hitsByStep,
  kickSong,
} from '../__fixtures__/euclidSongs';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import { ACCENT_MOD_DEFAULT, ACCENT_VELOCITY_DEFAULT } from '../audioConstants';
import type { OnsetEvent } from '../sequencing/euclideanSequencer';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT } from '../worklet/fm/stepModTables';
import type { Arrangement, SequencerSpec } from './arrangement';
import { PartBinding } from './partBinding';

const BAR = TICKS_PER_BAR;

/**
 * What the player sent before lanes: one trigger per onset at the spec's
 * note and hold and the part's velocity. The onsets come from a binding of
 * the same part on a transport of its own, run in step.
 */
function oldRule(arrangement: Arrangement, bars: number): Call[] {
  const part = arrangement.parts.find((p) => p.slot === KICK_SLOT)!;
  const transport = new TickTransport(arrangement.transport.bpm);
  const calls: Call[] = [];
  const onset = (event: OnsetEvent, spec: SequencerSpec): void => {
    if (spec.kind !== 'euclidean') return;
    calls.push({
      kind: 'trigger',
      note: spec.note,
      velocity: part.velocity,
      duration: spec.hold,
      time: event.time,
    });
  };
  const config = {
    regions: part.regions,
    songTicks: arrangement.transport.bars * BAR,
    harmony: arrangement.harmony,
  };
  const sampler = new ScaleSampler(arrangement.harmony);
  PartBinding.create(transport, part, config, sampler, { note: () => {}, onset })!.attach();
  for (let i = 0; i < bars * BAR; i++) transport.advance(transport.transportSeconds);
  return calls;
}

describe('a Euclid part with no lanes (windsor#355)', () => {
  it('plays every hit as before: note, velocity, hold and time, with no extras', () => {
    const arrangement = kickSong({
      sequencer: {
        density: { kind: 'lfoBars', bars: 2, shape: 'tri' },
        pulses: { min: 1, max: 9, start: 4 },
      },
      part: {
        regions: [
          { start: 0, duration: 2 * BAR },
          {
            start: 2 * BAR,
            duration: 2 * BAR,
            pattern: { ...KICK_SPEC, pattern: figure(0, 3, 6, 11) },
          },
        ],
      },
    });
    const { parts, run } = rig(arrangement);
    run(8);
    const triggers = parts.kick.calls.filter((call) => call.kind === 'trigger');
    expect(triggers).toEqual(oldRule(arrangement, 8));
    expect(triggers.length).toBeGreaterThan(20);
    expect(triggers.every((call) => call.extras === undefined)).toBe(true);
  });
});

describe('Euclid lanes at their own lengths (windsor#355)', () => {
  it('a 7-step accent lane over 16 steps accents hit s exactly when lane[s mod 7] is on', () => {
    const accentLane = [true, false, false, true, false, true, false];
    const { parts, run } = rig(
      kickSong({
        sequencer: { pattern: figure(0, 2, 5, 8, 11, 13), accentLane },
        part: { velocity: 0.9 },
      }),
    );
    run(7);
    const hits = hitsByStep(parts.kick);
    expect(hits.length).toBe(7 * 6);
    for (const hit of hits) {
      const accented = accentLane[hit.step % 7] === true;
      expect(hit.velocity, `step ${hit.step}`).toBe(
        accented ? Math.min(1, 0.9 + ACCENT_VELOCITY_DEFAULT) : 0.9,
      );
      expect(hit.extras?.mod).toBe(accented ? ACCENT_MOD_DEFAULT : undefined);
    }
    expect(new Set(hits.filter((h) => h.extras).map((h) => h.step % 7))).toEqual(
      new Set([0, 3, 5]),
    );
  });

  it('takes the part’s own accent amounts', () => {
    const sequencer = { pattern: ALL_ON, accentLane: [true], accentVelocity: 0.05, accentMod: 0.4 };
    const { parts, run } = rig(kickSong({ sequencer, part: { velocity: 0.5 } }));
    run(1);
    const hits = hitsByStep(parts.kick);
    expect(hits.every((h) => h.velocity === 0.55 && h.extras?.mod === 0.4)).toBe(true);
  });

  it('a pitch lane moves the note, clamped to MIDI, and cycles at its own length', () => {
    const high = rig(kickSong({ sequencer: { pattern: ALL_ON, note: 120, pitchLane: [24] } }));
    high.run(1);
    expect(new Set(hitsByStep(high.parts.kick).map((h) => h.note))).toEqual(new Set([127]));
    const low = rig(kickSong({ sequencer: { pattern: ALL_ON, note: 5, pitchLane: [-24] } }));
    low.run(1);
    expect(new Set(hitsByStep(low.parts.kick).map((h) => h.note))).toEqual(new Set([0]));

    const pitchLane = [0, 7, -5, 12, 3];
    const cycling = rig(
      kickSong({ sequencer: { pattern: figure(0, 4, 9, 14), note: 48, pitchLane } }),
    );
    cycling.run(5);
    const hits = hitsByStep(cycling.parts.kick);
    expect(hits).toHaveLength(20);
    for (const hit of hits)
      expect(hit.note, `step ${hit.step}`).toBe(48 + pitchLane[hit.step % 5]!);
    expect(hits.every((h) => h.extras === undefined)).toBe(true);
  });

  it('mod lanes of lengths 5 and 10 give each hit its offsets in slot order, and none at 0', () => {
    const cutoff = [0, 0.5, 0, -0.25, 0];
    const width = [0, 0, 1, 0, 0, 0, 0, 0, -1, 0.75];
    const modLanes = [
      { param: 'ops.3.width' as const, values: width },
      { param: 'filter.cutoff' as const, values: cutoff },
    ];
    const { parts, run } = rig(kickSong({ sequencer: { pattern: ALL_ON, modLanes } }));
    run(3);
    const hits = hitsByStep(parts.kick);
    expect(hits).toHaveLength(48);
    for (const hit of hits) {
      const c = cutoff[hit.step % 5]!;
      const w = width[hit.step % 10]!;
      if (c === 0 && w === 0) {
        expect(hit.extras, `step ${hit.step}`).toBeUndefined();
        continue;
      }
      const expected = new Array<number>(STEP_MOD_SLOT_COUNT).fill(0);
      expected[STEP_MOD_PARAMS.indexOf('filter.cutoff')] = c;
      expected[STEP_MOD_PARAMS.indexOf('ops.3.width')] = w;
      expect(hit.extras, `step ${hit.step}`).toEqual({ mod: 0, slide: false, stepMod: expected });
    }
  });

  it('a region entered from outside starts every lane at index 0', () => {
    // The second region starts on global step 40: 40 mod 3 and 40 mod 7 are not 0.
    const regions = [
      { start: 0, duration: BAR + BAR / 2 },
      { start: 2 * BAR + BAR / 2, duration: BAR },
    ];
    const sequencer = {
      pattern: ALL_ON,
      note: 60,
      accentLane: [true, false, false],
      pitchLane: [0, 1, 2, 3, 4, 5, 6],
    };
    const { parts, run } = rig(kickSong({ sequencer, part: { regions } }));
    run(FULL_ARRANGEMENT.transport.bars);
    const hits = hitsByStep(parts.kick);
    const entry = 2 * 16 + 8;
    const second = hits.filter((h) => h.step >= entry);
    expect(second).toHaveLength(16);
    second.forEach((hit, local) => {
      expect(hit.note, `local step ${local}`).toBe(60 + (local % 7));
      expect(hit.extras !== undefined, `local step ${local}`).toBe(local % 3 === 0);
    });
  });
});
