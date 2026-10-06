/**
 * A knob edit beside another field's lane (windsor#628, fix round for PR
 * #632): while only the switch lane holds a native kind's wet and dry gains,
 * a Mix edit is that field's new resting value, so the gains reach the new
 * Mix's values from the audio clock's now, and the lane's later breakpoints
 * still apply.
 *
 * So too after the switch's button has moved them (fix round 2 for PR #635):
 * a param with events ignores a plain value write, so the edit is an event
 * from now, and one made mid-fade turns the rest of the fade onto the new
 * Mix.
 */
import { describe, expect, it } from 'vitest';

import { build, openSpec } from '../__fixtures__/insertStageRig';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { sources } from '../__fixtures__/stripRig';
import { driveCompensation } from './driveInsert';
import { CHORUS_VOICE_CENTRES_MS, INSERT_SWITCH_FADE_S } from './insertConstants';
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
    // The switch off still applies, once it has crossed its fade (windsor#629).
    expect(wet!.valueAt(OFF_AT + INSERT_SWITCH_FADE_S)).toBe(0);
    expect(dry!.valueAt(OFF_AT + INSERT_SWITCH_FADE_S)).toBe(1);
  });
});

/** The wet and dry gains at `mix` with the switch's fade at `on`. */
const switchedCases = [
  {
    kind: 'chorus' as const,
    gains: (mix: number, on: number) => [(on * mix) / CHORUS_VOICE_CENTRES_MS.length, 1 - on * mix],
  },
  { kind: 'echo' as const, gains: (mix: number, on: number) => [on * mix, 1 - on * mix] },
];

describe('a Mix edit after the button has switched the insert off and on', () => {
  /** Long after the off's end, so even the Echo's on starts at once. */
  const SWITCH_ON = OFF_AT + 1;
  const MID_FADE = SWITCH_ON + INSERT_SWITCH_FADE_S / 2;
  const LATER = SWITCH_ON + 1;

  /** The stage switched off and on by its spec, and its wet and dry gains. */
  function switched(kind: 'chorus' | 'echo') {
    const spec = openSpec(kind);
    const { stage, context } = build(spec);
    const [wet, dry] = (sources(stage.output) as unknown as { gain: FakeParam }[]).map(
      (n) => n.gain,
    );
    context.currentTime = OFF_AT;
    stage.set({ ...spec, enabled: false } as InsertSpec);
    context.currentTime = SWITCH_ON;
    stage.set(spec);
    const edit = (now: number): void => {
      context.currentTime = now;
      stage.set({ ...spec, mix: MIX } as InsertSpec);
    };
    return { spec, wet: wet!, dry: dry!, edit };
  }

  it.each(switchedCases)('$kind: once the fade is over, the gains take it from now', (c) => {
    const { spec, wet, dry, edit } = switched(c.kind);
    const [oldWet] = c.gains((spec as { readonly mix: number }).mix, 1);
    expect(wet.valueAt(LATER + EPSILON)).toBeCloseTo(oldWet!, 9);
    edit(LATER);

    const [newWet, newDry] = c.gains(MIX, 1);
    expect(newWet).not.toBeCloseTo(oldWet!, 6);
    for (const t of [LATER + EPSILON, LATER + 1]) {
      expect(wet.valueAt(t)).toBeCloseTo(newWet!, 9);
      expect(dry.valueAt(t)).toBeCloseTo(newDry!, 9);
    }
  });

  it.each(switchedCases)('$kind: mid-fade, the rest of the fade lands on it', (c) => {
    const { wet, dry, edit } = switched(c.kind);
    edit(MID_FADE);

    // From the fade's half way, with the new Mix, to the new Mix's full value.
    const [halfWet, halfDry] = c.gains(MIX, 1 / 2);
    expect(wet.valueAt(MID_FADE)).toBeCloseTo(halfWet!, 9);
    expect(dry.valueAt(MID_FADE)).toBeCloseTo(halfDry!, 9);
    const [newWet, newDry] = c.gains(MIX, 1);
    for (const t of [SWITCH_ON + INSERT_SWITCH_FADE_S, LATER]) {
      expect(wet.valueAt(t)).toBeCloseTo(newWet!, 9);
      expect(dry.valueAt(t)).toBeCloseTo(newDry!, 9);
    }
  });
});
