/**
 * A MIDI CC's performance value on a part's voice target (windsor#781,
 * record `2026-10-13-midi-cc-mapping` decisions 3 and 8): an offset from the
 * patch's value on the target's slot, absolute, given back exactly on clear;
 * a clip envelope rides on top of it; a lane that plays the target wins; and
 * it keeps its slot after the lanes and ahead of the envelopes. The worklet's
 * answer to a slot's offset is `synth/fmProcessorAutomation.test.ts`'s.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import {
  ENVELOPE_OWNER,
  ENVELOPE_SONG_TICKS,
  clipEnvelopeRig,
  envPoint,
  envelope,
  envelopeOffsetAt,
  rollPart,
  rollPattern,
} from '../__fixtures__/clipEnvelopeRig';
import { installWorklet } from '../__fixtures__/stripRig';
import { makePatch } from '../patch/patch';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { ccValue } from '../song/ccMapping';
import { FM_LANES_MAX } from './automationTargetTables';
import { catalogRow, voiceTargetId } from './automationTargets';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

const BAR = 96;
const WHOLE = { start: 0, duration: ENVELOPE_SONG_TICKS };
const CUTOFF = 'voice.filter.cutoff';
/** The record's worked example: the patch's cutoff is 1 kHz. */
const PATCH = makePatch({ filter: { cutoff: 1000 } });
const LANE_PATHS = ['ops.0.level', 'ops.1.level', 'ops.2.level', 'ops.3.level', 'lfo.amount'];
const flat = (path: RollEnvelope['target'], value: number): RollEnvelope =>
  envelope(path, [envPoint(0, value), envPoint(BAR - 1, value)]);
const partOf = (envelopes: readonly RollEnvelope[]) =>
  rollPart([{ ...WHOLE, pattern: rollPattern(BAR, envelopes) }]);
const lanesOn = (paths: readonly string[]) =>
  paths.map((path) => lane(voiceTargetId(path), [point(0, 0.5)]));
const relativeOf = (map: unknown): readonly boolean[] | undefined =>
  (map as { relative?: boolean[] }).relative;
const posts = (rig: { part: { node: unknown } }): { type: string }[] =>
  (rig.part.node as { posted: { type: string }[] }).posted;

describe('a performance value on a voice target', () => {
  it('moves a held note’s cutoff by its offset from the patch, and gives the patch back on clear', async () => {
    const rig = await clipEnvelopeRig(partOf([]), { patch: PATCH });
    const patches = posts(rig).filter((m) => m.type === 'patch').length;
    rig.now = 0.5;
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 2000)).toBe('applied');
    expect(rig.slot('filter.cutoff').valueAt(0.5)).toBe(1);
    expect(relativeOf(rig.lastSlotMap())).toBeUndefined();
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 4000)).toBe('applied');
    expect(rig.slot('filter.cutoff').valueAt(0.5)).toBe(2);
    const param = rig.slot('filter.cutoff');

    rig.now = 1;
    rig.player.unperform(ENVELOPE_OWNER, CUTOFF);
    expect(rig.holds('filter.cutoff')).toBe(false);
    expect(param.valueAt(1)).toBe(0);
    // A performance never edits the patch.
    expect(posts(rig).filter((m) => m.type === 'patch').length).toBe(patches);
  });

  it('plays the record’s worked example: 3479.1 Hz under a +1 octave envelope is 6958.2 Hz', async () => {
    const plusOctave = flat('filter.cutoff', 1 / 4.5);
    const rig = await clipEnvelopeRig(partOf([plusOctave]), { patch: PATCH });
    const times = rig.run(BAR);
    expect(envelopeOffsetAt(plusOctave, 0, BAR)).toBeCloseTo(1, 12);
    const slot = rig.part.voiceSlotOf('filter.cutoff')!;
    expect(relativeOf(rig.lastSlotMap())?.[slot]).toBe(true);

    const value = ccValue(catalogRow(CUTOFF)!, { min: 2000, max: 6000, inverted: false }, 64);
    expect(value).toBeCloseTo(3479.1, 1);
    rig.now = times[10]!;
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, value)).toBe('applied');
    const param = rig.slot('filter.cutoff');
    expect(rig.part.voiceSlotOf('filter.cutoff')).toBe(slot);
    expect(relativeOf(rig.lastSlotMap())).toBeUndefined();
    for (const tick of [10, 40, 80]) {
      const offset = param.valueAt(times[tick]!);
      expect(offset).toBeCloseTo(2.7987, 4);
      expect(1000 * 2 ** offset).toBeCloseTo(6958.2, 1);
    }

    // Cleared, the envelope plays on alone, relative again, on the slot it kept.
    rig.now = times[50]!;
    rig.player.unperform(ENVELOPE_OWNER, CUTOFF);
    expect(param.valueAt(times[60]!)).toBeCloseTo(1, 12);
    expect(rig.part.voiceSlotOf('filter.cutoff')).toBe(slot);
    expect(relativeOf(rig.lastSlotMap())?.[slot]).toBe(true);
  });

  it('is ignored while a lane plays the target, which the sound follows', async () => {
    const rig = await clipEnvelopeRig(partOf([]), {
      patch: PATCH,
      lanes: [lane(CUTOFF, [point(0, 4000)])],
    });
    rig.now = 0.5;
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 2000)).toBe('automated');
    expect(rig.slot('filter.cutoff').valueAt(0.5)).toBe(2);

    // Held first, a lane switched on takes the target; switched off, the patch's value is back.
    rig.player.setLanes(ENVELOPE_OWNER, []);
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 2000)).toBe('applied');
    rig.player.setLanes(ENVELOPE_OWNER, [lane(CUTOFF, [point(0, 4000)])]);
    expect(rig.slot('filter.cutoff').valueAt(0.5)).toBe(2);
    rig.player.setLanes(ENVELOPE_OWNER, []);
    expect(rig.holds('filter.cutoff')).toBe(false);
  });
});

describe('the voice slots: lanes, then performance values, then envelopes', () => {
  it('reads no-slot when the lanes and envelopes hold all eight', async () => {
    const lanePaths = LANE_PATHS.slice(0, 4);
    const envelopes = (['lfo.rate', 'lfo2.amount', 'lfo2.rate', 'filter.envAmount'] as const).map(
      (path) => flat(path, 0.5),
    );
    expect(lanePaths.length + envelopes.length).toBe(FM_LANES_MAX);
    const rig = await clipEnvelopeRig(partOf(envelopes), { lanes: lanesOn(lanePaths) });
    rig.run(4);
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 2000)).toBe('no-slot');
    expect(rig.holds('filter.cutoff')).toBe(false);
  });

  it('keeps a held value’s slot ahead of an envelope admitted later, and at a lane edit', async () => {
    const lanePaths = [...LANE_PATHS, 'filter.resonance'];
    expect(lanePaths.length).toBe(FM_LANES_MAX - 2);
    const first = flat('filter.envAmount', 0.5);
    const second = flat('lfo2.amount', 0.5);
    const rig = await clipEnvelopeRig(partOf([first, second]), {
      patch: PATCH,
      lanes: lanesOn(lanePaths),
    });
    expect(rig.player.perform(ENVELOPE_OWNER, CUTOFF, 2000)).toBe('applied');
    rig.run(4);
    expect(rig.holds('filter.cutoff')).toBe(true);
    expect(rig.holds('filter.envAmount')).toBe(true);
    expect(rig.holds('lfo2.amount')).toBe(false);

    // A seventh lane: the envelope gives its slot up, the performance value keeps its own.
    rig.player.setLanes(ENVELOPE_OWNER, lanesOn([...lanePaths, 'lfo.rate']));
    rig.run(4);
    expect(rig.holds('filter.cutoff')).toBe(true);
    expect(rig.holds('lfo.rate')).toBe(true);
    expect(rig.holds('filter.envAmount')).toBe(false);
  });
});
