/**
 * Which clip envelopes take a voice slot, and how the slot reads 0
 * (windsor#718): only an envelope that can change the sound takes one (a
 * macro past the patch's count cannot), the rule runs again at a preset
 * switch and a patch edit, and an envelope with no song lane on its target
 * marks its slot `relative`, which a lane on the target takes back. What
 * the tracks hold is what `envelopeTargets` reads back to the app.
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
import { makeMacro, makePatch } from '../patch/patch';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { FM_LANES_MAX } from './automationTargetTables';
import { voiceTargetId } from './automationTargets';
import { admittedEnvelopes } from './clipEnvelopeAdmission';

let restore: () => void = () => {};
beforeAll(() => {
  restore = installWorklet();
});
afterAll(() => restore());

const BAR = 96;
const WHOLE = { start: 0, duration: ENVELOPE_SONG_TICKS };
const rise = (path: RollEnvelope['target']): RollEnvelope =>
  envelope(path, [envPoint(0, -1), envPoint(BAR - 1, 1)]);

/** The relative flags of the slot map the processor was last told; none when it carried none. */
const relativeOf = (map: unknown): readonly boolean[] | undefined =>
  (map as { relative?: boolean[] }).relative;

describe('an envelope takes a slot only when it can change the sound', () => {
  it('leaves a macro the patch lacks without a slot, and gives it one once a preset defines it', async () => {
    const lanePaths = ['ops.0.level', 'ops.1.level', 'ops.2.level', 'ops.3.level', 'lfo.amount'];
    const lanes = lanePaths.map((path) => lane(voiceTargetId(path), [point(0, 0.5)]));
    // Ordered before the audible three: it once took the slot the last of them needed.
    const macro = rise('macros.1.value');
    const audible = (['filter.cutoff', 'filter.envAmount', 'lfo2.amount'] as const).map(rise);
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [macro, ...audible]) }]);
    const rig = await clipEnvelopeRig(part, { lanes, patch: makePatch() });
    expect(lanePaths.length + audible.length).toBe(FM_LANES_MAX);
    const times = rig.run(BAR);
    expect(rig.holds('macros.1.value')).toBe(false);
    for (const env of audible) {
      const slot = rig.slot(env.target);
      expect(slot.valueAt(times[48]!)).toBeCloseTo(envelopeOffsetAt(env, 48, BAR), 9);
      expect(slot.valueAt(times[80]!)).toBeGreaterThan(slot.valueAt(times[16]!));
    }

    // A preset with two macros: the macro sounds now, and comes first in the roll's order.
    rig.part.setPatch(makePatch({ macros: [makeMacro(), makeMacro()] }));
    rig.player.resync(ENVELOPE_OWNER);
    rig.run(4);
    expect(rig.holds('macros.1.value')).toBe(true);
    expect(rig.holds('filter.cutoff')).toBe(true);
    expect(rig.holds('filter.envAmount')).toBe(true);
    expect(rig.holds('lfo2.amount')).toBe(false);

    // A patch edit that drops it gives its slot back, and the last envelope has it again.
    rig.part.setPatch(makePatch());
    rig.player.resync(ENVELOPE_OWNER);
    rig.run(4);
    expect(rig.holds('macros.1.value')).toBe(false);
    expect(rig.holds('lfo2.amount')).toBe(true);
    expect(lanePaths.every((path) => rig.holds(path))).toBe(true);
  });
});

describe('the held set the app reads (windsor#725)', () => {
  it('keeps the envelope already holding the last slot when the next region orders another first', async () => {
    const lanePaths = [
      'ops.0.level',
      'ops.1.level',
      'ops.2.level',
      'ops.3.level',
      'lfo.amount',
      'lfo2.amount',
      'filter.resonance',
    ];
    expect(lanePaths.length).toBe(FM_LANES_MAX - 1);
    const lanes = lanePaths.map((path) => lane(voiceTargetId(path), [point(0, 0.5)]));
    const a = rise('filter.cutoff');
    const b = rise('filter.envAmount');
    const part = rollPart([
      { start: 0, duration: BAR, pattern: rollPattern(BAR, [a]) },
      { start: BAR, duration: BAR, pattern: rollPattern(BAR, [b, a]) },
    ]);
    const rig = await clipEnvelopeRig(part, { lanes });
    const out: string[] = [];
    /** The live read, and the envelope targets holding a voice slot, which it must match. */
    const read = (): string[] => [...rig.player.envelopeTargets(ENVELOPE_OWNER.part, out)];
    const holding = (): string[] => [a.target, b.target].filter((path) => rig.holds(path));

    expect(read()).toEqual([]);
    rig.run(BAR / 2);
    expect(read()).toEqual(['filter.cutoff']);
    expect(holding()).toEqual(['filter.cutoff']);

    // Into the second region: from a fresh start B would win the last slot, but A holds it.
    rig.run(BAR);
    const fresh = admittedEnvelopes({
      lanes,
      held: [],
      envelopes: [b, a],
      loopTicks: BAR,
      slots: FM_LANES_MAX,
      sounds: () => true,
    });
    expect(fresh).toEqual(['filter.envAmount']);
    expect(read()).toEqual(['filter.cutoff']);
    expect(holding()).toEqual(['filter.cutoff']);
    expect(rig.player.envelopeTargets(ENVELOPE_OWNER.part, out)).toBe(out);
  });

  it('reads none for a part with no tracks', async () => {
    const rig = await clipEnvelopeRig(rollPart([{ ...WHOLE, pattern: rollPattern(BAR, []) }]));
    rig.run(4);
    expect(rig.player.envelopeTargets(ENVELOPE_OWNER.part, ['stale'])).toEqual([]);
  });
});

describe('an envelope’s 0 is the patch’s own value (windsor#718)', () => {
  it('marks its slot relative alone, absolute with a lane on its target, and relative again without', async () => {
    const decay = envelope('ops.0.env.decayTime', [envPoint(0, 0)]);
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, [decay]) }]);
    const rig = await clipEnvelopeRig(part);
    rig.run(4);
    const slot = rig.part.voiceSlotOf('ops.0.env.decayTime')!;
    expect(relativeOf(rig.lastSlotMap())?.[slot]).toBe(true);

    rig.player.setLanes(ENVELOPE_OWNER, [lane('voice.ops.0.env.decayTime', [point(0, 0)])]);
    rig.run(4);
    expect(rig.part.voiceSlotOf('ops.0.env.decayTime')).toBe(slot);
    expect(relativeOf(rig.lastSlotMap())).toBeUndefined();

    rig.player.setLanes(ENVELOPE_OWNER, []);
    rig.run(4);
    expect(rig.part.voiceSlotOf('ops.0.env.decayTime')).toBe(slot);
    expect(relativeOf(rig.lastSlotMap())?.[slot]).toBe(true);
  });

  it('leaves a lane’s slot map as it was: no relative flags', async () => {
    const part = rollPart([{ ...WHOLE, pattern: rollPattern(BAR, []) }]);
    const rig = await clipEnvelopeRig(part, {
      lanes: [lane('voice.ops.0.env.decayTime', [point(0, 0)])],
    });
    rig.run(4);
    expect(rig.lastSlotMap()).toEqual({
      type: 'voiceSlots',
      slots: ['ops.0.env.decayTime', ...Array.from({ length: FM_LANES_MAX - 1 }, () => null)],
    });
  });
});
