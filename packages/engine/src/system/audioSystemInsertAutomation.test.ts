/**
 * A part's insert lanes on the live engine (windsor#345, record
 * `2026-10-01-song-automation-lanes` decisions 2, 8, 9 and 14): they play
 * through each stage's `param`, re-attach and reschedule from now when the
 * insert chain is rebuilt inside its fade (a reorder, an add, a remove),
 * stop once their insert is gone, and stay inert while their field is
 * unread (Tape's `wear` split, its `wow` unsplit), picked up again from the
 * moment it is read.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import { valueAt } from '../automation/automationEvaluate';
import type { AutomationLane } from '../automation/automationLane';
import { insertTargetRow } from '../automation/automationTargets';
import { DEFAULT_DELAY } from '../inserts/delaySpec';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import { DEFAULT_TAPE } from '../inserts/tapeSpec';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { hat } = FULL_SLOT;
const TICK = 60 / FULL_DOCUMENT.transport.bpm / PPQ;
const FIRST = SCHEDULER_START_DELAY_SECONDS;

const TAPE = { ...DEFAULT_TAPE, id: 'tape1', split: false } as InsertSpec;
const PHASER = { ...DEFAULT_PHASER, id: 'phase1' } as InsertSpec;
const DELAY = { ...DEFAULT_DELAY, id: 'delay1' } as InsertSpec;

/** Tape's drive over the whole song, and its wear and wow, each a slow rise. */
const SONG = 4 * TICKS_PER_BAR;
const DRIVE = lane('insert.tape1.drive', [point(0, -6), point(SONG, 18)]);
const WEAR = lane('insert.tape1.wear', [point(0, 10), point(SONG, 90)]);
const WOW = lane('insert.tape1.wow', [point(0, 20), point(SONG, 80)]);
const RATE = lane('insert.phase1.rate', [point(0, 0.2), point(SONG, 4)]);

const param = (stage: InsertStage<InsertSpec> | undefined, name: string): FakeParam =>
  stage!.processor!.parameters.get(name) as unknown as FakeParam;

interface Rig {
  readonly sys: AudioSystem;
  readonly context: FakeContext;
  /** The hat's live stage of kind `kind`. */
  stage(kind: string): InsertStage<InsertSpec> | undefined;
  play(until: number): void;
  /** Run the re-wires waiting out their fade, at `time`. */
  settle(time: number): void;
}

async function rig(inserts: InsertSpec[], automation: readonly AutomationLane[]): Promise<Rig> {
  const context = new FakeContext();
  const waiting: (() => void)[] = [];
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), {
    defer: (run) => waiting.push(run),
  });
  await sys.init();
  const strip = { ...FULL_STRIPS.hat, inserts };
  sys.initMusic(withDocumentPart(FULL_DOCUMENT, 'hat', { strip, automation }));
  return {
    sys,
    context,
    stage: (kind) => sys.strip(musicPartName(hat))!.inserts.find((s) => s.kind === kind),
    play(until) {
      for (let t = context.currentTime; t <= until; t += 0.025) {
        context.currentTime = t;
        sys.update(0);
      }
      context.currentTime = until;
    },
    settle(time) {
      context.currentTime = time;
      for (const run of waiting.splice(0)) run();
    },
  };
}

const setInserts = (sys: AudioSystem, inserts: InsertSpec[]) =>
  sys.apply({ parts: { [hat]: { strip: { inserts } } } });

/** The lane's value at `time` on a transport started at 0. */
const laneAt = (l: AutomationLane, kind: 'tape' | 'phaser', time: number): number =>
  valueAt(insertTargetRow(kind, l.target.split('.').at(-1)!)!, l.points, (time - FIRST) / TICK);

const ramps = (p: FakeParam) => p.automation.filter((e) => e.call === 'linearRampToValueAtTime');

describe('insert lanes, playing', () => {
  it("schedules each lane on its stage's param, tracing the curve", async () => {
    const { sys, stage, play } = await rig([TAPE, PHASER], [DRIVE, RATE]);
    sys.startMusic();
    play(1);
    const drive = param(stage('tape'), 'drive');
    const rate = param(stage('phaser'), 'rate');
    expect(ramps(drive).length).toBeGreaterThan(30);
    expect(ramps(rate).length).toBeGreaterThan(30);
    for (let tick = 1; tick < 30; tick++) {
      const time = FIRST + tick * TICK;
      expect(drive.valueAt(time)).toBeCloseTo(laneAt(DRIVE, 'tape', time), 9);
      expect(rate.valueAt(time)).toBeCloseTo(laneAt(RATE, 'phaser', time), 9);
    }
  });
});

describe('a chain rebuild re-attaches the lanes', () => {
  /** What a param logged since the re-wire: a hold at `at`, at the lane's value there, then ramps. */
  function expectReattached(
    logged: FakeParam['automation'],
    l: AutomationLane,
    kind: 'tape' | 'phaser',
    at: number,
  ) {
    expect(logged.slice(0, 2).map((e) => [e.call, e.time])).toEqual([
      ['cancelScheduledValues', at],
      ['setValueAtTime', at],
    ]);
    expect(logged[1]!.value).toBeCloseTo(laneAt(l, kind, at), 6);
    const after = logged.slice(2);
    expect(after.length).toBeGreaterThan(10);
    for (const e of after) expect(e.call).toBe('linearRampToValueAtTime');
  }

  it('adding an insert moves the lanes to the new stages, from the re-wire on', async () => {
    const { sys, stage, play, settle } = await rig([TAPE, PHASER], [DRIVE, RATE]);
    sys.startMusic();
    play(1);
    const oldTape = stage('tape');
    const oldDrive = param(oldTape, 'drive');
    expect(setInserts(sys, [DELAY, TAPE, PHASER]).ok).toBe(true);
    // Until the fade has landed, the old stages are the live ones.
    expect(stage('tape')).toBe(oldTape);
    const mark = oldDrive.automation.length;
    settle(1.02);
    const tape = stage('tape');
    expect(tape).not.toBe(oldTape);
    play(1.5);
    expectReattached(param(tape, 'drive').automation, DRIVE, 'tape', 1.02);
    expectReattached(param(stage('phaser'), 'rate').automation, RATE, 'phaser', 1.02);
    // The old stage was let go at the re-wire and heard nothing after it.
    expect(oldDrive.automation.slice(mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1.02 },
      { call: 'setValueAtTime', value: DEFAULT_TAPE.drive, time: 1.02 },
    ]);
  });

  it('reordering keeps the same stages and restarts their lanes from the re-wire', async () => {
    const { sys, stage, play, settle } = await rig([TAPE, PHASER], [DRIVE, RATE]);
    sys.startMusic();
    play(1);
    const tape = stage('tape');
    const drive = param(tape, 'drive');
    const rate = param(stage('phaser'), 'rate');
    expect(setInserts(sys, [PHASER, TAPE]).ok).toBe(true);
    const marks = [drive.automation.length, rate.automation.length] as const;
    settle(1.02);
    expect(stage('tape')).toBe(tape);
    expect(sys.strip(musicPartName(hat))!.inserts.map((s) => s.kind)).toEqual(['phaser', 'tape']);
    play(1.5);
    expectReattached(drive.automation.slice(marks[0]), DRIVE, 'tape', 1.02);
    expectReattached(rate.automation.slice(marks[1]), RATE, 'phaser', 1.02);
  });

  it('swapping two of one kind moves a lane with its insert, not its stage', async () => {
    // The same kinds in the same order: settings on the same stages, no fade (#652).
    const other = { ...TAPE, id: 'tape2', drive: 3 } as InsertSpec;
    const { sys, play } = await rig([TAPE, other], [DRIVE]);
    sys.startMusic();
    play(1);
    const [first, second] = sys.strip(musicPartName(hat))!.inserts;
    const [was, now] = [param(first, 'drive'), param(second, 'drive')];
    const marks = [was.automation.length, now.automation.length] as const;
    expect(setInserts(sys, [other, TAPE]).ok).toBe(true);
    expect(sys.strip(musicPartName(hat))!.inserts).toEqual([first, second]);
    play(1.5);
    // The first stage now plays tape2: it goes back to tape2's drive, and the lane follows tape1.
    expect(was.automation.slice(marks[0])).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1 },
      { call: 'setValueAtTime', value: 3, time: 1 },
    ]);
    expect(was.value).toBe(3);
    expectReattached(now.automation.slice(marks[1]), DRIVE, 'tape', 1);
  });

  it('removing an insert re-attaches the rest, and a lane on the removed one stops', async () => {
    const { sys, stage, play, settle } = await rig([TAPE, PHASER], [DRIVE, RATE]);
    sys.startMusic();
    play(1);
    const drive = param(stage('tape'), 'drive');
    expect(setInserts(sys, [PHASER]).ok).toBe(true);
    const mark = drive.automation.length;
    settle(1.02);
    expect(stage('tape')).toBeUndefined();
    play(1.5);
    expectReattached(param(stage('phaser'), 'rate').automation, RATE, 'phaser', 1.02);
    expect(drive.automation.slice(mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1.02 },
      { call: 'setValueAtTime', value: DEFAULT_TAPE.drive, time: 1.02 },
    ]);
  });

  it('stops a lane whose insert the document deleted along with it', async () => {
    const { sys, stage, play, settle } = await rig([TAPE, PHASER], [DRIVE, RATE]);
    sys.startMusic();
    play(1);
    const drive = param(stage('tape'), 'drive');
    const mark = drive.automation.length;
    const partial = { strip: { inserts: [PHASER] }, automation: [RATE] };
    expect(sys.apply({ parts: { [hat]: partial } }).ok).toBe(true);
    expect(sys.automationLanes(hat).map((l) => l.target)).toEqual([RATE.target]);
    settle(1.02);
    play(1.5);
    expect(drive.automation.slice(mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1 },
      { call: 'setValueAtTime', value: DEFAULT_TAPE.drive, time: 1 },
    ]);
  });
});

describe('a lane on a field the insert does not read is inert', () => {
  it('plays wear unsplit and leaves wow to the spec, then swaps when Tape splits', async () => {
    const { sys, stage, play } = await rig([TAPE], [WEAR, WOW]);
    sys.startMusic();
    play(1);
    const tape = stage('tape');
    const wear = param(tape, 'wear');
    const wow = param(tape, 'wow');
    expect(ramps(wear).length).toBeGreaterThan(30);
    expect(wow.automation).toEqual([]);
    expect(wow.value).toBe(DEFAULT_TAPE.wow);

    let mark = wear.automation.length;
    expect(setInserts(sys, [{ ...TAPE, split: true } as InsertSpec]).ok).toBe(true);
    // Split: wear goes back to the spec at once, wow picks up its lane from now.
    expect(wear.automation.slice(mark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1 },
      { call: 'setValueAtTime', value: DEFAULT_TAPE.wear, time: 1 },
    ]);
    expect(wow.automation.slice(0, 2).map((e) => [e.call, e.time])).toEqual([
      ['cancelScheduledValues', 1],
      ['setValueAtTime', 1],
    ]);
    expect(wow.automation[1]!.value).toBeCloseTo(laneAt(WOW, 'tape', 1), 6);
    mark = wear.automation.length;
    play(1.5);
    expect(wear.automation.length).toBe(mark);
    expect(ramps(wow).length).toBeGreaterThan(10);

    // Unsplit again: the lanes swap back from then.
    const wowMark = wow.automation.length;
    expect(setInserts(sys, [TAPE]).ok).toBe(true);
    expect(wow.automation.slice(wowMark)).toEqual([
      { call: 'cancelScheduledValues', value: expect.any(Number), time: 1.5 },
      { call: 'setValueAtTime', value: DEFAULT_TAPE.wow, time: 1.5 },
    ]);
    expect(wear.automation.slice(mark, mark + 2).map((e) => [e.call, e.time])).toEqual([
      ['cancelScheduledValues', 1.5],
      ['setValueAtTime', 1.5],
    ]);
    expect(wear.automation[mark + 1]!.value).toBeCloseTo(laneAt(WEAR, 'tape', 1.5), 6);
  });
});
