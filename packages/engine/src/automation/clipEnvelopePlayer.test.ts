/**
 * A roll's clip envelopes on the automation player (windsor#702, epic
 * windsor#699): a real part's voice slots read tick by tick, against the
 * envelope's own value at the region's loop tick, through the wrap, a seek,
 * the region's end, a stop, back-to-back regions, the slot limit, an
 * envelope off and a song lane on the same target.
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
import { makeMacro } from '../patch/patch';
import { makePatch } from '../patch/patch';
import { voiceOffset } from '../synth/voiceAutomation';
import { AUTOMATION_STEP_RAMP_SECONDS } from './automationConstants';
import { valueAt } from './automationEvaluate';
import { FM_LANES_MAX } from './automationTargetTables';
import { requireCatalogRow, voiceTargetId } from './automationTargets';
import { clipEnvelopeSource } from './clipEnvelopeSource';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

const STEP = AUTOMATION_STEP_RAMP_SECONDS;
const BAR = 96;
/** A rising Cutoff over one bar: −1 at its first tick, +1 at its last. */
const RISE = envelope('filter.cutoff', [envPoint(0, -1), envPoint(BAR - 1, 1)]);
/** The whole song, one region. */
const WHOLE = { start: 0, duration: ENVELOPE_SONG_TICKS };

describe('an envelope on its voice slot', () => {
  it('moves a ringing voice: the slot rises tick by tick under a rising Cutoff', async () => {
    const pattern = rollPattern(
      4 * BAR,
      [{ ...RISE, points: [envPoint(0, -1), envPoint(4 * BAR - 1, 1)] }],
      [{ tick: 0, ticks: 4 * BAR, pitch: 60 }],
    );
    const rig = await clipEnvelopeRig(rollPart([{ ...WHOLE, pattern }]));
    const times = rig.run(4 * BAR);
    const slot = rig.slot('filter.cutoff');
    const env = pattern.kind === 'roll' ? pattern.envelopes![0]! : RISE;
    let before = -Infinity;
    for (let tick = 0; tick < 4 * BAR; tick++) {
      const value = slot.valueAt(times[tick]!);
      expect(value).toBeCloseTo(envelopeOffsetAt(env, tick, 4 * BAR), 9);
      expect(value).toBeGreaterThan(before);
      before = value;
    }
    expect(rig.lastSlotMap()).toEqual({
      type: 'voiceSlots',
      slots: ['filter.cutoff', ...Array.from({ length: FM_LANES_MAX - 1 }, () => null)],
    });
  });

  it('repeats with the loop: a 1-bar loop in a 4-bar region plays four times, jumping at each wrap', async () => {
    const rig = await clipEnvelopeRig(rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]));
    const times = rig.run(4 * BAR);
    const slot = rig.slot('filter.cutoff');
    for (let tick = 0; tick < 4 * BAR; tick++) {
      const at = tick % BAR === 0 && tick > 0 ? times[tick]! + STEP : times[tick]!;
      expect(slot.valueAt(at)).toBeCloseTo(envelopeOffsetAt(RISE, tick % BAR, BAR), 9);
    }
    // At each wrap the value before is the loop's end, then a de-click to its start.
    const wrap = times[2 * BAR]!;
    expect(slot.valueAt(wrap)).toBeCloseTo(envelopeOffsetAt(RISE, BAR - 1, BAR), 9);
    expect(slot.valueAt(wrap + STEP)).toBeCloseTo(envelopeOffsetAt(RISE, 0, BAR), 9);
  });

  it('lands a seek into the third repeat on that repeat’s loop tick', async () => {
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]);
    const rig = await clipEnvelopeRig(part, { restTick: 2 * BAR + 40 });
    const times = rig.run(10);
    const slot = rig.slot('filter.cutoff');
    expect(slot.automation.slice(0, 2)).toEqual([
      { call: 'cancelScheduledValues', value: 0, time: times[0] },
      { call: 'setValueAtTime', value: envelopeOffsetAt(RISE, 40, BAR), time: times[0] },
    ]);
    expect(slot.valueAt(times[9]!)).toBeCloseTo(envelopeOffsetAt(RISE, 49, BAR), 9);
  });

  it('takes no slot for an envelope that is off, and gives no part a source with only that', async () => {
    const off = { ...RISE, on: false };
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [off]) }]);
    expect(clipEnvelopeSource(part, ENVELOPE_SONG_TICKS)).toBeNull();
    const both = rollPart([
      { ...WHOLE, pattern: rollPattern(BAR, [off, envelope('lfo.amount', [envPoint(0, 0.5)])]) },
    ]);
    const rig = await clipEnvelopeRig(both);
    rig.run(BAR);
    expect(rig.holds('filter.cutoff')).toBe(false);
    expect(rig.holds('lfo.amount')).toBe(true);
  });

  it('is silent on a target the patch maps from a macro (windsor#560)', async () => {
    const patch = {
      ...makePatch(),
      macros: [makeMacro({ mappings: [{ target: 'filter.cutoff' }] })],
    };
    const rig = await clipEnvelopeRig(rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]), {
      patch,
    });
    rig.run(BAR);
    expect(rig.holds('filter.cutoff')).toBe(false);
  });
});

describe('the region’s end and the transport’s stop', () => {
  it('ramps the offset to 0 at the region’s end, then gives the slot back', async () => {
    const part = rollPart([{ start: 0, duration: BAR, pattern: rollPattern(BAR, [RISE]) }]);
    const rig = await clipEnvelopeRig(part);
    const times = rig.run(BAR + 4);
    const slot = rig.slot('filter.cutoff');
    const end = times[BAR]!;
    expect(slot.valueAt(end)).toBeCloseTo(envelopeOffsetAt(RISE, BAR, BAR), 9);
    expect(slot.valueAt(end + STEP)).toBe(0);
    // Still held while the ramp is ahead of the clock; given back on the first tick after it.
    expect(rig.holds('filter.cutoff')).toBe(true);
    rig.now = end + STEP;
    rig.run(1);
    expect(rig.holds('filter.cutoff')).toBe(false);
    expect(rig.lastSlotMap()).toEqual({
      type: 'voiceSlots',
      slots: Array(FM_LANES_MAX).fill(null),
    });
  });

  it('ramps a playing envelope out from the playhead at a stop, and frees the slot after', async () => {
    const rig = await clipEnvelopeRig(rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]));
    const times = rig.run(48);
    const slot = rig.slot('filter.cutoff');
    rig.now = times[40]!;
    rig.player.stop();
    expect(slot.automation.slice(-3)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: rig.now },
      { call: 'setValueAtTime', value: envelopeOffsetAt(RISE, 40, BAR), time: rig.now },
      { call: 'linearRampToValueAtTime', value: 0, time: rig.now + STEP },
    ]);
    expect(rig.holds('filter.cutoff')).toBe(true);
    expect(rig.deferred).toHaveLength(1);
    rig.now += STEP;
    rig.deferred[0]!();
    expect(rig.holds('filter.cutoff')).toBe(false);
  });

  it.each([
    ['before', 4],
    ['inside', 12],
  ])(
    'cancels a short region the look-ahead queued whole at a stop %s it, and frees the slot',
    async (_, at) => {
      const short = envelope('filter.cutoff', [envPoint(0, 1), envPoint(7, 0.5)]);
      const part = rollPart([{ start: 8, duration: 8, pattern: rollPattern(8, [short]) }]);
      const rig = await clipEnvelopeRig(part);
      // Queued past the region's end: its track reads not live, though the region is ahead.
      const times = rig.run(24);
      const slot = rig.slot('filter.cutoff');
      rig.now = times[at]!;
      rig.player.stop();
      const log = slot.automation;
      const cancel = log.map((event) => event.call).lastIndexOf('cancelScheduledValues');
      expect(log[cancel]!.time).toBe(rig.now);
      expect(log.slice(cancel + 1).every((event) => event.time! <= rig.now + STEP)).toBe(true);
      for (let tick = at + 1; tick < 24; tick++) expect(slot.valueAt(times[tick]!)).toBe(0);
      rig.now += STEP;
      for (const run of rig.deferred) run();
      expect(rig.holds('filter.cutoff')).toBe(false);
    },
  );

  it('plays each back-to-back region’s own envelopes, from each region’s tick 0', async () => {
    const fall = envelope('filter.cutoff', [envPoint(0, 0.5), envPoint(BAR - 1, -1)]);
    const wobble = envelope('lfo.amount', [envPoint(0, 0.5), envPoint(BAR / 2, -0.5)]);
    const part = rollPart([
      { start: 0, duration: BAR, pattern: rollPattern(BAR, [RISE]) },
      { start: BAR, duration: BAR, pattern: rollPattern(BAR, [fall]) },
      { start: 2 * BAR, duration: BAR, pattern: rollPattern(BAR, [wobble]) },
    ]);
    const rig = await clipEnvelopeRig(part);
    const times = rig.run(BAR + 1);
    const cutoff = rig.slot('filter.cutoff');
    rig.now = times[BAR]!;
    const more = rig.run(BAR + 8);
    const all = [...times, ...more];
    for (let tick = 1; tick < BAR; tick++) {
      expect(cutoff.valueAt(all[tick]!)).toBeCloseTo(envelopeOffsetAt(RISE, tick, BAR), 9);
      expect(cutoff.valueAt(all[BAR + tick]!)).toBeCloseTo(envelopeOffsetAt(fall, tick, BAR), 9);
    }
    // The second region starts at its own tick 0, stepped to from the first's end.
    expect(cutoff.valueAt(all[BAR]!)).toBeCloseTo(envelopeOffsetAt(RISE, BAR, BAR), 9);
    expect(cutoff.valueAt(all[BAR]! + STEP)).toBeCloseTo(envelopeOffsetAt(fall, 0, BAR), 9);
    const lfo = rig.slot('lfo.amount');
    expect(lfo.valueAt(all[2 * BAR + 4]!)).toBeCloseTo(envelopeOffsetAt(wobble, 4, BAR), 9);
    // The third region names no Cutoff: its slot ramps out and is given back.
    expect(cutoff.valueAt(all[2 * BAR]! + STEP)).toBe(0);
    rig.now = all[2 * BAR]! + STEP;
    rig.run(1);
    expect(rig.holds('filter.cutoff')).toBe(false);
    expect(rig.holds('lfo.amount')).toBe(true);
  });
});

describe('with the song’s lanes', () => {
  const CUTOFF = requireCatalogRow('voice.filter.cutoff');
  const SWEEP = lane('voice.filter.cutoff', [point(0, 400), point(4 * BAR, 1600)]);

  it('sums a song lane and an envelope on one target in one slot', async () => {
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]);
    const rig = await clipEnvelopeRig(part, { lanes: [SWEEP] });
    const times = rig.run(2 * BAR);
    const slot = rig.slot('filter.cutoff');
    for (let tick = 1; tick < 2 * BAR; tick++) {
      if (tick === BAR) continue;
      const laneOffset = voiceOffset(
        rig.part.patch,
        'filter.cutoff',
        CUTOFF,
        valueAt(CUTOFF, SWEEP.points, tick),
      );
      expect(slot.valueAt(times[tick]!)).toBeCloseTo(
        laneOffset + envelopeOffsetAt(RISE, tick % BAR, BAR),
        9,
      );
    }
    expect(rig.part.voiceSlotOf('filter.cutoff')).toBe(0);
    expect(rig.part.voiceSlotOf('lfo.amount')).toBeUndefined();
  });

  it('leaves a lane no envelope names writing exactly what it wrote without envelopes', async () => {
    const LFO = lane('voice.lfo.amount', [point(0, 0.1, 0.4), point(2 * BAR, 0.9)]);
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [RISE]) }]);
    const plain = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, []) }]);
    const withEnvelope = await clipEnvelopeRig(part, { lanes: [LFO] });
    const without = await clipEnvelopeRig(plain, { lanes: [LFO] });
    withEnvelope.run(2 * BAR);
    without.run(2 * BAR);
    expect(withEnvelope.slot('lfo.amount').automation).toEqual(
      without.slot('lfo.amount').automation,
    );
  });

  it('goes back to the lane alone where the region ends, and keeps the lane’s slot', async () => {
    const part = rollPart([{ start: 0, duration: BAR, pattern: rollPattern(BAR, [RISE]) }]);
    const rig = await clipEnvelopeRig(part, { lanes: [SWEEP] });
    const times = rig.run(BAR + 8);
    rig.now = times[BAR + 7]!;
    rig.run(1);
    const slot = rig.slot('filter.cutoff');
    const laneAt = (tick: number): number =>
      voiceOffset(rig.part.patch, 'filter.cutoff', CUTOFF, valueAt(CUTOFF, SWEEP.points, tick));
    for (let tick = BAR + 1; tick < BAR + 8; tick++) {
      expect(slot.valueAt(times[tick]!)).toBeCloseTo(laneAt(tick), 9);
    }
    expect(rig.holds('filter.cutoff')).toBe(true);
  });

  it('gives no slot to an envelope whose points all sit past the loop, so the audible ones fit', async () => {
    const lanePaths = ['ops.0.level', 'ops.1.level', 'ops.2.level', 'ops.3.level', 'lfo.amount'];
    const lanes = lanePaths.map((path) => lane(voiceTargetId(path), [point(0, 0.5)]));
    // Its only point at `loopTicks`: never read, so it reads 0 throughout.
    const silent = envelope('filter.resonance', [envPoint(BAR, 1)]);
    const audible = ['filter.cutoff', 'filter.envAmount', 'lfo2.amount'].map((path) =>
      envelope(path as typeof RISE.target, [envPoint(0, -1), envPoint(BAR - 1, 1)]),
    );
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [silent, ...audible]) }]);
    const rig = await clipEnvelopeRig(part, { lanes });
    expect(FM_LANES_MAX - lanePaths.length).toBe(audible.length);
    const times = rig.run(BAR);
    expect(rig.holds('filter.resonance')).toBe(false);
    for (const env of audible) {
      const slot = rig.slot(env.target);
      expect(slot.valueAt(times[48]!)).toBeCloseTo(envelopeOffsetAt(env, 48, BAR), 9);
      expect(slot.valueAt(times[80]!)).toBeGreaterThan(slot.valueAt(times[16]!));
    }
  });

  it('skips an envelope past the part’s slots without throwing, and the lanes keep theirs', async () => {
    const lanePaths = [
      'ops.0.level',
      'ops.1.level',
      'ops.2.level',
      'ops.3.level',
      'lfo.amount',
      'lfo2.amount',
      'filter.resonance',
    ];
    const lanes = lanePaths.map((path) => lane(voiceTargetId(path), [point(0, 0.5)]));
    const envelopes = [RISE, envelope('filter.envAmount', [envPoint(0, 0.5)])];
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, envelopes) }]);
    const rig = await clipEnvelopeRig(part, { lanes });
    const slots = lanePaths.map((path) => rig.part.voiceSlotOf(path));
    expect(() => rig.run(BAR)).not.toThrow();
    expect(rig.holds('filter.cutoff')).toBe(true);
    expect(rig.holds('filter.envAmount')).toBe(false);
    expect(lanePaths.map((path) => rig.part.voiceSlotOf(path))).toEqual(slots);
    // A lane added live takes its slot back from an envelope: song lanes first.
    rig.player.setLanes(ENVELOPE_OWNER, [...lanes, lane('voice.pitchEnvAmount', [point(0, 2)])]);
    expect(rig.holds('pitchEnvAmount')).toBe(true);
    expect(rig.holds('filter.cutoff')).toBe(false);
    expect(() => rig.run(BAR)).not.toThrow();
    expect(rig.holds('filter.cutoff')).toBe(false);
  });
});
