/**
 * A knob edit beside another field's lane (windsor#628, fix round for PR
 * #632): while only the switch lane holds a native kind's wet and dry gains,
 * a Mix edit is that field's new resting value, so the gains reach the new
 * Mix's values from the audio clock's now, and the lane's later breakpoints
 * still apply.
 */
import { describe, expect, it } from 'vitest';

import { build, openSpec } from '../__fixtures__/insertStageRig';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { sources } from '../__fixtures__/stripRig';
import { driveCompensation } from './driveInsert';
import type { InsertSpec } from './insertRegistry';

/** Past a breakpoint by far less than the gap to the next. */
const EPSILON = 1e-6;
const ON_AT = 1;
const NOW = 2;
const OFF_AT = 3;
const MIX = 0.8;

const cases = [
  {
    kind: 'drive' as const,
    wetAt: (s: InsertSpec) => (s.kind === 'drive' ? s.mix * driveCompensation(s.drive) : NaN),
  },
  { kind: 'echo' as const, wetAt: (s: InsertSpec) => (s.kind === 'echo' ? s.mix : NaN) },
];

describe('a Mix edit while only the switch lane is engaged', () => {
  it.each(cases)('$kind: the gains take the new Mix from now, then the lane', (c) => {
    const spec = openSpec(c.kind);
    const { stage, context } = build(spec);
    // The output hears the wet gain, then the dry.
    const [wet, dry] = (sources(stage.output) as unknown as { gain: FakeParam }[]).map(
      (n) => n.gain,
    );
    const toggle = stage.param!('enabled')!;
    toggle.schedule(1, ON_AT, 'set');
    toggle.schedule(0, OFF_AT, 'set');
    const before = wet!.valueAt(NOW + EPSILON);
    context.currentTime = NOW;
    const edited = { ...spec, mix: MIX } as InsertSpec;
    stage.set(edited);

    expect(c.wetAt(edited)).not.toBeCloseTo(before, 6);
    expect(wet!.valueAt(NOW + EPSILON)).toBeCloseTo(c.wetAt(edited), 9);
    expect(dry!.valueAt(NOW + EPSILON)).toBeCloseTo(1 - MIX, 9);
    expect(wet!.valueAt(OFF_AT + EPSILON)).toBe(0);
    expect(dry!.valueAt(OFF_AT + EPSILON)).toBe(1);
  });
});
