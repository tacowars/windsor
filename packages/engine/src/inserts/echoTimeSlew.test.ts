/**
 * Every Echo time change outside a lane slews (windsor#816, record
 * `2026-10-16-echo-follows-song-tempo` decision 3, fix round 2 for PR #817):
 * a linear ramp over `ECHO_TIME_SLEW_S` from where the line is now, turning
 * mid-ramp with no step, and the switch's wait reads the longest time a ramp
 * still running passes through, a ramp turned mid-way counting only as far as
 * it reached (fix round 3). The param's timeline is replayed as Web
 * Audio would hold it (`__fixtures__/paramTimeline.ts`).
 */
import { describe, expect, it } from 'vitest';

import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { build } from '../__fixtures__/insertStageRig';
import { sources } from '../__fixtures__/stripRig';
import type { EchoSpec } from './echoInsert';
import { DEFAULT_ECHO } from './echoInsert';
import { ECHO_TIME_SLEW_S } from './echoConstants';
import { ringTime } from './echoSwitchSettle';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import type { InsertStage } from './insertKind';

const S = ECHO_TIME_SLEW_S;
const AT = 2;
const synced = (division: EchoSpec['division']): EchoSpec => ({ ...DEFAULT_ECHO, division });
const free = (delayTime: number): EchoSpec => ({ ...DEFAULT_ECHO, sync: false, delayTime });

/** The Echo's stage on a fresh context at 120 bpm, and its loop's time param. */
function echoStage(spec: EchoSpec) {
  const { stage, context } = build(spec);
  const time = context.delays[0]!.delayTime as unknown as FakeParam;
  return { stage: stage as InsertStage<EchoSpec>, context, time };
}

/** The line's time runs linearly from `from` at `at` to `to` a slew later, and stays there. */
function expectSlew(time: FakeParam, at: number, from: number, to: number): void {
  expect(time.valueAt(at)).toBeCloseTo(from, 9);
  expect(time.valueAt(at + S / 4)).toBeCloseTo(from + (to - from) / 4, 9);
  expect(time.valueAt(at + S / 2)).toBeCloseTo((from + to) / 2, 9);
  expect(time.valueAt(at + S)).toBeCloseTo(to, 9);
  expect(time.valueAt(at + 4 * S)).toBeCloseTo(to, 9);
  expect(time.automation.at(-1)).toEqual({
    call: 'linearRampToValueAtTime',
    value: to,
    time: at + S,
  });
}

describe('a time change slews', () => {
  it.each([
    {
      change: 'a tempo change',
      spec: DEFAULT_ECHO,
      edit: (stage: InsertStage<EchoSpec>) => stage.setTempo!(100),
      from: 0.375,
      to: 0.45,
    },
    {
      change: 'a note value change',
      spec: DEFAULT_ECHO,
      edit: (stage: InsertStage<EchoSpec>) => stage.set(synced('1/4')),
      from: 0.375,
      to: 0.5,
    },
    {
      change: 'the free Time knob',
      spec: free(0.28),
      edit: (stage: InsertStage<EchoSpec>) => stage.set(free(0.5)),
      from: 0.28,
      to: 0.5,
    },
    {
      change: 'Sync on',
      spec: { ...free(0.61), division: '1/16' as const },
      edit: (stage: InsertStage<EchoSpec>) => stage.set({ ...synced('1/16'), delayTime: 0.61 }),
      from: 0.61,
      to: 0.125,
    },
    {
      change: 'Sync off',
      spec: { ...synced('1/16'), delayTime: 0.61 },
      edit: (stage: InsertStage<EchoSpec>) => stage.set({ ...free(0.61), division: '1/16' }),
      from: 0.125,
      to: 0.61,
    },
  ])('$change ramps linearly from the time now, over the slew', ({ spec, edit, from, to }) => {
    const { stage, context, time } = echoStage(spec);
    context.currentTime = AT;
    edit(stage);
    expectSlew(time, AT, from, to);
  });

  it('turns a change made mid-ramp from where the ramp has reached', () => {
    const { stage, context, time } = echoStage(DEFAULT_ECHO);
    context.currentTime = AT;
    stage.setTempo!(100);
    const turn = AT + 0.4 * S;
    const reached = 0.375 + 0.4 * (0.45 - 0.375);
    expect(time.valueAt(turn)).toBeCloseTo(reached, 9);
    context.currentTime = turn;
    // A quarter at 100 bpm, from where the tempo's ramp stands: no step.
    stage.set(synced('1/4'));
    expectSlew(time, turn, reached, 0.6);
  });

  it('then a Sync off plays the saved free time, not the slew’s target', () => {
    const spec = { ...DEFAULT_ECHO, delayTime: 0.61 };
    const { stage, context, time } = echoStage(spec);
    context.currentTime = AT;
    stage.setTempo!(100);
    context.currentTime = AT + 1;
    stage.set({ ...spec, sync: false });
    expectSlew(time, AT + 1, 0.45, 0.61);
  });
});

describe('the switch’s wait over a slew', () => {
  /** The wet gain of a playing 1/1 Echo, shortened to 1/32T at `AT` and switched off at `offAt`, on right after. */
  function wetAfterShortening(offAt: number) {
    const spec = { ...synced('1/1'), mix: 1 };
    const { stage, context } = echoStage(spec);
    const [wet] = (sources(stage.output) as unknown as { gain: FakeParam }[]).map((n) => n.gain);
    const short = { ...spec, division: '1/32T' as const };
    context.currentTime = AT;
    stage.set(short);
    context.currentTime = offAt;
    stage.set({ ...short, enabled: false });
    const offEnd = offAt + INSERT_SWITCH_FADE_S;
    context.currentTime = offEnd + 1 / context.sampleRate;
    stage.set(short);
    const ring = ringTime(spec.damp, spec.resonance, context.sampleRate);
    return { wet: wet!, offEnd, open: ring + INSERT_SWITCH_FADE_S + 0.01 };
  }

  it('waits for the whole note while the ramp from it runs, not the 1/32T it heads for', () => {
    // A whole note at 120 bpm is 2 s; a thirty-second triplet, 1/24 s.
    const { wet, offEnd, open } = wetAfterShortening(AT + S / 5);
    expect(wet.valueAt(offEnd + 1 / 24 + open)).toBe(0);
    expect(wet.valueAt(offEnd + 2 - 0.01)).toBe(0);
    expect(wet.valueAt(offEnd + 2 + open)).toBe(1);
  });

  it('waits only for the time a reversed ramp reached, not the target it turned from', () => {
    // 1/32T heading for 1/1, turned back at a fifth of the way: the line reached
    // about 0.43 s and never 2 s (Codex P1 on PR #817, fix round 3).
    const spec = { ...synced('1/32T'), mix: 1 };
    const { stage, context } = echoStage(spec);
    const [wet] = (sources(stage.output) as unknown as { gain: FakeParam }[]).map((n) => n.gain);
    context.currentTime = AT;
    stage.set({ ...spec, division: '1/1' });
    const turn = AT + S / 5;
    const reached = 1 / 24 + (2 - 1 / 24) / 5;
    context.currentTime = turn;
    stage.set(spec);
    context.currentTime = turn + S / 10;
    stage.set({ ...spec, enabled: false });
    const offEnd = turn + S / 10 + INSERT_SWITCH_FADE_S;
    context.currentTime = offEnd + 1 / context.sampleRate;
    stage.set(spec);
    const open = ringTime(spec.damp, spec.resonance, context.sampleRate) + INSERT_SWITCH_FADE_S;
    expect(wet!.valueAt(offEnd + reached - 0.01)).toBe(0);
    expect(wet!.valueAt(offEnd + reached + open + 0.01)).toBe(1);
  });

  it('waits for the 1/32T alone once the ramp is over', () => {
    const { wet, offEnd, open } = wetAfterShortening(AT + 2 * S);
    expect(wet.valueAt(offEnd + 1 / 24 + open)).toBe(1);
  });
});
