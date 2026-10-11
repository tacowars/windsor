/**
 * Song chord on the live system and in an offline render (windsor#729): a
 * bloom on Song chord holds the chord under the playhead at rest, after a
 * seek and after ■, while one on a fixed scale keeps its own; on the running
 * transport the change lands one fade before the chord's tick; a switch to a
 * fixed scale mid-play plays it from now with no stale chord landing later;
 * a bloom added mid-play starts on the chord under the playhead; a tempo
 * edit re-plans the ticks already issued; and the render puts the retune on
 * the boundary.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import { FULL_DOCUMENT, FULL_SLOT, FULL_STRIPS } from '../__fixtures__/fullArrangement';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { RENDER_QUANTUM_FRAMES } from '../render/renderConstants';
import { renderPass } from '../render/renderPass';
import { planFor } from '../render/renderSong';
import { SCALES } from '../sequencing/scaleSampler';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import { BLOOM_GENERATOR } from './bloomGeneratorConstants';
import { chordPitches, pitchMask } from './bloomPitches';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';
import type { InsertSpec, InsertStage } from './insertRegistry';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const FADE = BLOOM_GENERATOR.switchSeconds;
const { harmony } = FULL_DOCUMENT;
/** D dorian: i for bars 1–2, iv from bar 3. */
const [I, IV] = harmony.events.map((event) => chordPitches(harmony, event)) as [number, number];
const BOUNDARY = harmony.events[1]!.start;
const F_MAJOR = pitchMask(5, SCALES.major);
const { hat, arp } = FULL_SLOT;

const bloom = (scale: BloomSpec['scale']): InsertSpec =>
  ({ ...DEFAULT_BLOOM, id: `bloom-${scale}`, key: 'F', scale }) as InsertSpec;
const SONG: ArrangementDocument = {
  ...FULL_DOCUMENT,
  parts: FULL_DOCUMENT.parts.map((part) =>
    part.slot === hat
      ? { ...part, strip: { ...FULL_STRIPS.hat, inserts: [bloom('dorian')] } }
      : part,
  ),
  master: { level: 1, inserts: [bloom('chord')] },
};

const pitchesOf = (stage: InsertStage<InsertSpec> | undefined): FakeParam =>
  stage!.processor!.parameters.get('pitches') as unknown as FakeParam;
const setCalls = (param: FakeParam, from = 0) =>
  param.automation.slice(from).filter((c) => c.call === 'setValueAtTime');

async function live() {
  const context = new FakeContext();
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await sys.init();
  sys.initMusic(SONG);
  const issued = new Map<number, number>();
  sys.scheduler.subscribe(1, (event) => issued.set(event.tick, event.time));
  const master = (): FakeParam => pitchesOf(sys.masterStrip!.inserts[0]);
  const onStrip = (slot: number): FakeParam =>
    pitchesOf(sys.strip(musicPartName(slot))!.inserts[0]);
  /** Start, and run the clock until the transport has issued `tick`. */
  const playTo = (tick: number): void => {
    if (!sys.musicRunning) sys.startMusic();
    while (!issued.has(tick)) {
      context.currentTime += 0.01;
      sys.update(0.01);
    }
  };
  return { context, sys, issued, master, onStrip, playTo };
}

describe('Song chord, stopped', () => {
  it('holds the chord under the playhead at rest, after a seek and after ■', async () => {
    const { sys, master, onStrip, playTo } = await live();
    expect(master().value).toBe(I);
    expect(onStrip(hat).value).toBe(pitchMask(5, SCALES.dorian));
    expect(sys.seekMusic(BOUNDARY + 10)).toBe(true);
    expect(master().value).toBe(IV);
    playTo(BOUNDARY + 30);
    sys.stopMusic();
    expect(master().value).toBe(I);
    expect(onStrip(hat).automation).toEqual([]);
  });
});

describe('Song chord, playing', () => {
  it("changes one fade before the chord's tick", async () => {
    const { issued, master, playTo } = await live();
    playTo(BOUNDARY);
    const at = issued.get(BOUNDARY)!;
    expect(setCalls(master()).at(-1)).toEqual({
      call: 'setValueAtTime',
      value: IV,
      time: at - FADE,
    });
    expect(master().valueAt(issued.get(BOUNDARY - 1)!)).toBe(I);
    expect(master().valueAt(at)).toBe(IV);
  });

  it('switched to a fixed scale mid-play, plays it from now, and no chord lands later', async () => {
    const { context, sys, master, playTo } = await live();
    playTo(BOUNDARY);
    const param = master();
    const mark = param.automation.length;
    expect(sys.apply({ master: { inserts: [bloom('major')] } }).ok).toBe(true);
    expect(param.automation[mark]).toMatchObject({
      call: 'cancelScheduledValues',
      time: context.currentTime,
    });
    expect(param.value).toBe(F_MAJOR);
    playTo(2 * BOUNDARY + 10);
    expect(setCalls(param, mark)).toEqual([]);
  });

  it('starts a bloom added mid-play on the chord under the playhead', async () => {
    const { context, sys, onStrip, playTo } = await live();
    playTo(BOUNDARY + 20);
    const strip = { ...FULL_STRIPS.arp, inserts: [bloom('chord')] };
    expect(sys.apply({ parts: { [arp]: { strip } } }).ok).toBe(true);
    expect(onStrip(arp).valueAt(context.currentTime)).toBe(IV);
  });

  it('re-plans after a tempo edit: held from now, the issued change scheduled again', async () => {
    const { context, sys, issued, master, playTo } = await live();
    playTo(BOUNDARY);
    const param = master();
    const mark = param.automation.length;
    expect(sys.apply({ transport: { bpm: 120 } }).ok).toBe(true);
    const now = context.currentTime;
    expect(param.automation.slice(mark)).toEqual([
      { call: 'cancelScheduledValues', value: IV, time: now },
      { call: 'setValueAtTime', value: I, time: now },
      { call: 'setValueAtTime', value: IV, time: issued.get(BOUNDARY)! - FADE },
    ]);
  });
});

describe('Song chord in an offline render', () => {
  it('puts the retune on the boundary, within one render quantum', async () => {
    const rate = 8000;
    const plan = planFor(SONG, { sampleRate: rate, tailSeconds: 0 });
    let param: FakeParam | undefined;
    const issued = new Map<number, number>();
    await renderPass(
      SONG,
      plan,
      { sampleRate: rate, createContext: (init) => new FakeOfflineContext(init) },
      {
        channels: 2,
        attach: (system) => {
          param = pitchesOf(system.masterStrip!.inserts[0]);
          system.scheduler.subscribe(1, (event) => issued.set(event.tick, event.time));
          return () => {};
        },
      },
    );
    const change = setCalls(param!).find((c) => c.value === IV)!;
    const boundary = issued.get(BOUNDARY)!;
    expect(change.time! + FADE).toBeCloseTo(boundary, 12);
    // `pitches` is k-rate: the dip starts at the quantum the change falls in and ends a fade later.
    const quantum = RENDER_QUANTUM_FRAMES / rate;
    const retune = Math.ceil(change.time! / quantum) * quantum + FADE;
    expect(Math.abs(retune - boundary)).toBeLessThanOrEqual(quantum);
  });
});
