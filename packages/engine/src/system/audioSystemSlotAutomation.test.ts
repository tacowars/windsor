/**
 * A part's lane on an Echo's slot child, on the live engine (windsor#688,
 * record `2026-10-11-wet-path-slot` decision 6): `insert.<echoId>.slot.rate`
 * drives the Chorus child's rate through the host stage's `param`, survives
 * a same-kind edit of the child, and after a kind change re-resolves against
 * the new child (a Phaser's rate) or finds nothing (a Filter has no rate),
 * letting the old child go at the edit.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { nodesBetween } from '../__fixtures__/audioAnalysis';
import { lane, point } from '../__fixtures__/automationRig';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeNode, FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeDelay } from '../__fixtures__/fakeAudioNodes';
import { FakeOscillator } from '../__fixtures__/fakeOscillator';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import {
  ENGINE_WORKLETS,
  installParamWorklet,
  ParamWorkletNode,
} from '../__fixtures__/insertParamRig';
import { SCHEDULER_START_DELAY_SECONDS } from '../audioConstants';
import { valueAt } from '../automation/automationEvaluate';
import { insertTargetRow } from '../automation/automationTargets';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import { DEFAULT_FILTER } from '../inserts/filterSpec';
import { CHORUS_VOICE_RATIOS } from '../inserts/insertConstants';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import { PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { hat } = FULL_SLOT;
const TICK = 60 / FULL_DOCUMENT.transport.bpm / PPQ;
const FIRST = SCHEDULER_START_DELAY_SECONDS;
const EDIT = 1;

const echo = (slot: InsertSpec): InsertSpec =>
  ({ ...DEFAULT_ECHO, id: 'echo1', slot: { ...slot, id: 'child1' } }) as InsertSpec;
const CHORUS = echo(DEFAULT_CHORUS as InsertSpec);
const SONG = 4 * TICKS_PER_BAR;
const RATE = lane('insert.echo1.slot.rate', [point(0, 0.2), point(SONG, 4)]);

/** The lane's value at `time` on a transport started at 0. */
const laneAt = (time: number): number =>
  valueAt(insertTargetRow(CHORUS, 'slot.rate')!, RATE.points, (time - FIRST) / TICK);
const ramps = (p: FakeParam) => p.automation.filter((e) => e.call === 'linearRampToValueAtTime');
const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;

/** The newest child on `stage`'s wet path: its input, and every node on its way back. */
function child(stage: InsertStage<InsertSpec>): { input: FakeNode; inside: FakeNode[] } {
  const { send, ret } = stage.wetPath!;
  const input = fake(send.node).outbound.at(-1)!.to;
  return { input, inside: nodesBetween(input, fake(ret)) };
}

/** A Chorus child's LFOs: what drives its delays' times. */
const lfos = (stage: InsertStage<InsertSpec>): FakeOscillator[] =>
  child(stage)
    .inside.filter((n): n is FakeDelay => n instanceof FakeDelay)
    .flatMap((delay) => delay.delayTime.inputs.flatMap((depth) => depth.inbound))
    .map((c) => c.from)
    .filter((n): n is FakeOscillator => n instanceof FakeOscillator);

async function rig() {
  const context = new FakeContext();
  const waiting: (() => void)[] = [];
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), {
    defer: (run) => waiting.push(run),
  });
  await sys.init();
  const strip = { ...FULL_STRIPS.hat, inserts: [CHORUS] };
  sys.initMusic(withDocumentPart(FULL_DOCUMENT, 'hat', { strip, automation: [RATE] }));
  sys.startMusic();
  const play = (until: number): void => {
    for (let t = context.currentTime; t <= until; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    context.currentTime = until;
  };
  play(EDIT);
  return {
    sys,
    play,
    echo: () => sys.strip(musicPartName(hat))!.inserts.find((s) => s.kind === 'echo')!,
    edit: (slot: InsertSpec) =>
      sys.apply({ parts: { [hat]: { strip: { inserts: [echo(slot)] } } } }),
    settle: () => waiting.splice(0).forEach((run) => run()),
  };
}

/** Each LFO at `time` over the lane there: the chorus's voice ratios. */
const ratiosAt = (oscillators: FakeOscillator[], time: number): number[] =>
  oscillators.map((o) => o.frequency.valueAt(time) / laneAt(time)).sort((a, b) => a - b);

describe('a lane on a slot child', () => {
  it('drives a Chorus child’s rate', async () => {
    const { echo } = await rig();
    const oscillators = lfos(echo());
    expect(oscillators).toHaveLength(2 * CHORUS_VOICE_RATIOS.length);
    for (const o of oscillators) expect(ramps(o.frequency).length).toBeGreaterThan(30);
    for (let tick = 1; tick < 30; tick++) {
      const ratios = ratiosAt(oscillators, FIRST + tick * TICK);
      ratios.forEach((r, i) => expect(r).toBeCloseTo(CHORUS_VOICE_RATIOS[Math.floor(i / 2)]!, 6));
    }
  });

  it('keeps driving it through a same-kind edit of the child', async () => {
    const { echo, edit, play } = await rig();
    const oscillators = lfos(echo());
    expect(edit({ ...DEFAULT_CHORUS, depth: DEFAULT_CHORUS.depth / 2 } as InsertSpec).ok).toBe(
      true,
    );
    expect(lfos(echo())).toEqual(oscillators);
    play(1.5);
    for (const o of oscillators) {
      expect(ramps(o.frequency).filter((e) => e.time! > EDIT).length).toBeGreaterThan(10);
    }
    const onTick = FIRST + Math.round((1.4 - FIRST) / TICK) * TICK;
    expect(ratiosAt(oscillators, onTick)[0]).toBeCloseTo(CHORUS_VOICE_RATIOS[0]!, 6);
  });

  it('re-resolves against a Phaser child after a kind change, letting the Chorus go', async () => {
    const { echo, edit, play, settle } = await rig();
    const oscillators = lfos(echo());
    const marks = oscillators.map((o) => o.frequency.automation.length);
    expect(edit(DEFAULT_PHASER as InsertSpec).ok).toBe(true);
    const processor = child(echo()).inside.find((n) => n instanceof ParamWorkletNode);
    const rate = (processor as ParamWorkletNode).parameters.get('rate');
    play(1.5);
    expect(rate.automation.slice(0, 2).map((e) => [e.call, e.time])).toEqual([
      ['cancelScheduledValues', EDIT],
      ['setValueAtTime', EDIT],
    ]);
    expect(rate.automation[1]!.value).toBeCloseTo(laneAt(EDIT), 6);
    expect(ramps(rate).length).toBeGreaterThan(10);
    oscillators.forEach((o, i) => {
      expect(o.frequency.automation.slice(marks[i]).map((e) => [e.call, e.time])).toEqual([
        ['cancelScheduledValues', EDIT],
        ['setValueAtTime', EDIT],
      ]);
    });
    settle();
  });

  it('finds nothing on a Filter child, which has no rate', async () => {
    const { echo, edit, play } = await rig();
    const oscillators = lfos(echo());
    const marks = oscillators.map((o) => o.frequency.automation.length);
    expect(edit(DEFAULT_FILTER as InsertSpec).ok).toBe(true);
    play(1.5);
    oscillators.forEach((o, i) => {
      expect(o.frequency.automation.slice(marks[i]).map((e) => e.time)).toEqual([EDIT, EDIT]);
    });
    expect(echo().param!('slot.rate')).toBeUndefined();
  });
});
