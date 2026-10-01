/**
 * Strip lanes playing on the live system's transport (windsor#344): pan
 * moves the rotation's four gains with equal-power values at every
 * breakpoint, the send lanes drive their sends, and each discontinuity the
 * console can make (a start from a seeked tick, a seek, a stop, a mute, the
 * loop's jump back, a tempo change, a live lane edit) cancels and holds at
 * the tick it lands on.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import type { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT, FULL_SLOT, withDocumentPart } from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import { AUTOMATION_STEP_RAMP_SECONDS } from '../automation/automationConstants';
import { valueAt } from '../automation/automationEvaluate';
import type { AutomationLane } from '../automation/automationLane';
import { catalogRow } from '../automation/automationTargets';
import { PAN_ANGLE_MAX } from '../mixer/stereoRotate';
import { PPQ } from '../sequencing/scheduler';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from './audioSystem';

const restore = installSidechainWorklet();
afterAll(() => restore());

const { hat } = FULL_SLOT;
const LEVEL = catalogRow('strip.level')!;
const PAN = catalogRow('strip.pan')!;
const SEND = catalogRow('strip.send.a')!;
/** The fixture's 96 BPM. */
const TICK = 60 / FULL_DOCUMENT.transport.bpm / PPQ;
/** A transport started at time 0 issues its first tick here. */
const FIRST = SCHEDULER_START_DELAY_SECONDS;
const tickAt = (time: number, first = FIRST): number => Math.round((time - first) / TICK);

const FADE = lane('strip.level', [point(0, 0.25, 0.5), point(192, 1)]);

const param = (p: AudioParam): FakeParam => p as unknown as FakeParam;
const levelOf = (sys: AudioSystem): FakeParam => param(sys.strip(musicPartName(hat))!.part.gain);

async function rig(
  automation: readonly AutomationLane[],
  document: ArrangementDocument = FULL_DOCUMENT,
): Promise<{ sys: AudioSystem; context: FakeContext; play(until: number): void }> {
  const { system: sys, context } = await sidechainRig(
    withDocumentPart(document, 'hat', { automation }),
  );
  const play = (until: number): void => {
    for (let t = context.currentTime; t <= until; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    context.currentTime = until;
  };
  return { sys, context, play };
}

/** The last `n` calls on `p`. */
const last = (p: FakeParam, n = 2) => p.automation.slice(-n);
const held = (time: number, value: number) => [
  { call: 'cancelScheduledValues', value: expect.any(Number), time },
  { call: 'setValueAtTime', value, time },
];

describe('the strip targets, playing', () => {
  it('moves the four rotation gains together, equal-power, at every breakpoint', async () => {
    const sweep = lane('strip.pan', [point(0, -1), point(96, 1)]);
    const { sys, play } = await rig([sweep]);
    sys.startMusic();
    play(1);
    const gains = sys.strip(musicPartName(hat))!.rotation.gains;
    const [ll, lr, rl, rr] = [gains.ll, gains.lr, gains.rl, gains.rr].map((g) => param(g.gain));
    const logs = [ll!, lr!, rl!, rr!].map((p) =>
      p.automation.map(({ call, time }) => [call, time]),
    );
    expect(logs[1]).toEqual(logs[0]);
    expect(logs[2]).toEqual(logs[0]);
    expect(logs[3]).toEqual(logs[0]);
    const ramps = ll!.automation.flatMap((entry, i) =>
      entry.call === 'linearRampToValueAtTime' ? [i] : [],
    );
    expect(ramps.length).toBeGreaterThan(30);
    for (const i of ramps) {
      const pan = valueAt(PAN, sweep.points, tickAt(ll!.automation[i]!.time!));
      const theta = pan * PAN_ANGLE_MAX;
      expect(ll!.automation[i]!.value).toBeCloseTo(Math.cos(theta), 12);
      expect(lr!.automation[i]!.value).toBeCloseTo(-Math.sin(theta), 12);
      expect(rl!.automation[i]!.value).toBeCloseTo(Math.sin(theta), 12);
      expect(rr!.automation[i]!.value).toBeCloseTo(Math.cos(theta), 12);
    }
  });

  it('drives send A and send B from their lanes', async () => {
    const a = lane('strip.send.a', [point(0, 0), point(96, 1)]);
    const b = lane('strip.send.b', [point(0, 0.2), point(24, 0.2), point(24, 0.9)]);
    const { sys, play } = await rig([a, b]);
    sys.startMusic();
    play(1);
    const sends = sys.strip(musicPartName(hat))!.sends;
    const sendA = param(sends.get('a')!.gain);
    const sendB = param(sends.get('b')!.gain);
    for (let tick = 0; tick < 30; tick++) {
      expect(sendA.valueAt(FIRST + tick * TICK)).toBeCloseTo(valueAt(SEND, a.points, tick), 12);
    }
    const edge = FIRST + 24 * TICK;
    expect(sendB.valueAt(edge)).toBeCloseTo(0.2, 12);
    expect(sendB.valueAt(edge + AUTOMATION_STEP_RAMP_SECONDS)).toBeCloseTo(0.9, 12);
    expect(sendB.valueAt(edge + AUTOMATION_STEP_RAMP_SECONDS / 2)).toBeCloseTo(0.55, 12);
  });
});

describe('discontinuities on the live transport', () => {
  it('holds the seeked tick while stopped, and again when ▶ starts there', async () => {
    const { sys, context, play } = await rig([FADE]);
    context.currentTime = 0.3;
    expect(sys.seekMusic(48)).toBe(true);
    expect(last(levelOf(sys))).toEqual(held(0.3, valueAt(LEVEL, FADE.points, 48)));
    sys.startMusic();
    const mark = levelOf(sys).automation.length;
    play(0.32);
    const first = 0.3 + FIRST;
    expect(levelOf(sys).automation.slice(mark, mark + 2)).toEqual(
      held(first, valueAt(LEVEL, FADE.points, 48)),
    );
  });

  it('holds where the playhead stood on ■ and on a mute', async () => {
    for (const halt of [(s: AudioSystem) => s.stopMusic(), (s: AudioSystem) => s.setMuted(true)]) {
      const { sys, play } = await rig([FADE]);
      sys.startMusic();
      play(0.5);
      halt(sys);
      const [cancel, set] = last(levelOf(sys));
      expect(cancel).toMatchObject({ call: 'cancelScheduledValues', time: 0.5 });
      expect(set!.call).toBe('setValueAtTime');
      expect(set!.time).toBe(0.5);
      expect(set!.value).toBeCloseTo(valueAt(LEVEL, FADE.points, (0.5 - FIRST) / TICK), 12);
    }
  });

  it("holds the loop start's value at the loop's jump back", async () => {
    const looped: ArrangementDocument = {
      ...FULL_DOCUMENT,
      transport: { ...FULL_DOCUMENT.transport, loop: { start: 0, end: 96, on: true } },
    };
    const { sys, play } = await rig([FADE], looped);
    sys.startMusic();
    play(96 * TICK + 0.2);
    const jump = FIRST + 96 * TICK;
    const atJump = levelOf(sys).automation.filter((c) => Math.abs(c.time! - jump) < 1e-9);
    expect(atJump.map((c) => [c.call, c.value])).toEqual([
      ['cancelScheduledValues', expect.any(Number)],
      ['setValueAtTime', 0.25],
    ]);
  });

  it('holds from now on a tempo change, then plays on at the new tempo', async () => {
    const { sys, play } = await rig([FADE]);
    sys.startMusic();
    play(0.5);
    const mark = levelOf(sys).automation.length;
    expect(sys.apply({ transport: { bpm: 120 } }).ok).toBe(true);
    const calls = levelOf(sys).automation.slice(mark);
    expect(calls[0]).toMatchObject({ call: 'cancelScheduledValues', time: 0.5 });
    expect(calls[1]).toMatchObject({ call: 'setValueAtTime', time: 0.5 });
    expect(calls[1]!.value).toBeCloseTo(valueAt(LEVEL, FADE.points, (0.5 - FIRST) / TICK), 12);
    play(1);
    const times = levelOf(sys)
      .automation.filter((c) => c.call === 'linearRampToValueAtTime')
      .map((c) => c.time!);
    const step = times.at(-1)! - times.at(-2)!;
    expect(step).toBeCloseTo(60 / 120 / PPQ, 9);
  });

  it('cancels from now and plays the new curve on a live lane edit', async () => {
    const { sys, play } = await rig([FADE]);
    sys.startMusic();
    play(0.5);
    const edited = lane('strip.level', [point(0, 1), point(192, 0.1, -0.5)]);
    const mark = levelOf(sys).automation.length;
    sys.apply({ parts: { [hat]: { automation: [edited] } } });
    const calls = levelOf(sys).automation.slice(mark);
    expect(calls[0]).toMatchObject({ call: 'cancelScheduledValues', time: 0.5 });
    expect(calls[1]!.value).toBeCloseTo(valueAt(LEVEL, edited.points, (0.5 - FIRST) / TICK), 12);
    play(1.5);
    for (let tick = 30; tick < 50; tick++) {
      expect(levelOf(sys).valueAt(FIRST + tick * TICK)).toBeCloseTo(
        valueAt(LEVEL, edited.points, tick),
        12,
      );
    }
  });
});
