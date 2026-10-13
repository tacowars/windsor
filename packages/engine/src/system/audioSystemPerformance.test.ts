/**
 * A MIDI CC's performance values on the live system (windsor#781, record
 * `2026-10-13-midi-cc-mapping` decisions 2, 3 and 6): a strip's Level and an
 * insert's field follow a set value on the params a lane writes and go back
 * to the document's on clear; a value a lane takes over, or whose insert
 * goes, is dropped and reported; and the calls change nothing on a song
 * that holds no value. A preset switch drops a voice value and frees its
 * slot, and a patch edit keeps it. The voice path is
 * `automation/performancePlayer.test.ts`'s.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { DEFAULT_PHASER } from '../inserts/phaserSpec';
import type { InsertSpec } from '../inserts/insertRegistry';
import { makePatch } from '../patch/patch';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { hat } = FULL_SLOT;
const PHASER = { ...DEFAULT_PHASER, id: 'phase1', rate: 0.5 } as InsertSpec;

interface Rig {
  readonly sys: AudioSystem;
  readonly context: FakeContext;
  readonly dropped: [number, string][];
  level(): FakeParam;
  rate(): FakeParam | undefined;
  play(until: number): void;
  /** Run the re-wires waiting out their fade, at `time`. */
  settle(time: number): void;
}

async function rig(): Promise<Rig> {
  const context = new FakeContext();
  const waiting: (() => void)[] = [];
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), {
    defer: (run) => waiting.push(run),
  });
  await sys.init();
  const dropped: [number, string][] = [];
  sys.performanceDropped = (slot, target) => dropped.push([slot, target]);
  sys.initMusic(
    withDocumentPart(FULL_DOCUMENT, 'hat', { strip: { ...FULL_STRIPS.hat, inserts: [PHASER] } }),
  );
  const strip = () => sys.strip(musicPartName(hat))!;
  return {
    sys,
    context,
    dropped,
    level: () => strip().part.gain as unknown as FakeParam,
    rate: () =>
      strip()
        .inserts.find((s) => s.kind === 'phaser')
        ?.processor?.parameters.get('rate') as unknown as FakeParam | undefined,
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

describe('performance values on a part’s strip and inserts', () => {
  it('moves the Level and an insert field, and gives the document’s values back on clear', async () => {
    const { sys, level, rate, context } = await rig();
    context.currentTime = 0.5;
    expect(sys.setPerformance(hat, 'strip.level', 0.25)).toBe('applied');
    expect(sys.setPerformance(hat, 'insert.phase1.rate', 3)).toBe('applied');
    expect(level().value).toBe(0.25);
    expect(rate()!.value).toBe(3);
    // The strip's knob only records while the value holds the fader.
    sys.apply({ parts: { [hat]: { strip: { level: 0.4 } } } });
    expect(level().value).toBe(0.25);

    sys.clearPerformance(hat, 'strip.level');
    expect(level().value).toBe(0.4);
    sys.clearPartPerformance(hat);
    expect(rate()!.value).toBe(0.5);
    expect(sys.setPerformance(hat, 'insert.nothere.rate', 1)).toBe('inert');
  });

  it('drops a value a lane takes over or whose insert goes, and reports it', async () => {
    const { sys, level, dropped, settle } = await rig();
    sys.setPerformance(hat, 'strip.level', 0.25);
    sys.setPerformance(hat, 'insert.phase1.rate', 3);
    sys.apply({ parts: { [hat]: { automation: [lane('strip.level', [point(0, 0.5)])] } } });
    expect(dropped).toEqual([[hat, 'strip.level']]);
    expect(level().value).toBe(0.5);
    expect(sys.setPerformance(hat, 'strip.level', 0.25)).toBe('automated');

    sys.apply({ parts: { [hat]: { strip: { inserts: [] } } } });
    settle(1);
    expect(dropped).toEqual([
      [hat, 'strip.level'],
      [hat, 'insert.phase1.rate'],
    ]);
  });

  it('drops a voice value on a preset switch, frees its slot, and keeps a strip value', async () => {
    const { sys, level, dropped, context } = await rig();
    const part = () => sys.strip(musicPartName(hat))!.part;
    const cutoff = (hz: number) => makePatch({ filter: { cutoff: hz } });
    sys.apply({ patches: { cutA: cutoff(1000) }, parts: { [hat]: { preset: 'cutA' } } });
    context.currentTime = 0.5;
    expect(sys.setPerformance(hat, 'voice.filter.cutoff', 2000)).toBe('applied');
    expect(sys.setPerformance(hat, 'strip.level', 0.25)).toBe('applied');
    const slot = part().voiceSlotOf('filter.cutoff')!;
    const param = part().voiceSlotParams[slot] as unknown as FakeParam;
    expect(param.valueAt(0.5)).toBe(1);
    // A knob edit on the patch it plays keeps the value.
    sys.apply({ patches: { cutA: cutoff(1500) } });
    expect(part().voiceSlotOf('filter.cutoff')).toBe(slot);
    expect(dropped).toEqual([]);

    context.currentTime = 1;
    sys.apply({ patches: { cutB: cutoff(3000) }, parts: { [hat]: { preset: 'cutB' } } });
    expect(dropped).toEqual([[hat, 'voice.filter.cutoff']]);
    expect(part().voiceSlotOf('filter.cutoff')).toBeUndefined();
    expect(param.valueAt(1)).toBe(0);
    expect(part().patch.filter.cutoff).toBe(3000);
    expect(level().value).toBe(0.25);
  });

  it('writes nothing on a song that holds no value', async () => {
    const { sys, play } = await rig();
    sys.startMusic();
    play(1);
    const parts = Object.values(FULL_SLOT).map((slot) => sys.strip(musicPartName(slot))!.part);
    const snapshot = () =>
      parts.map((part) => [
        (part.node as unknown as FakeWorkletNode).posted.length,
        (part.gain as unknown as FakeParam).automation.length,
        ...part.voiceSlotParams.map((p) => (p as unknown as FakeParam).automation.length),
      ]);
    const before = snapshot();
    sys.clearPerformance(hat, 'voice.filter.cutoff');
    sys.clearPartPerformance(hat);
    sys.resetPerformance();
    expect(snapshot()).toEqual(before);
  });
});
