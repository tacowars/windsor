/**
 * Switch lanes on the live engine and in an offline render (windsor#628,
 * record `2026-10-06-insert-switch-lanes` decisions 2–5): a lane on an
 * insert's `enabled` turns a worklet kind (Filter) and a native kind (Plate)
 * off over bar 2 and on again at bar 3, on a part strip and on a group bus,
 * live and offline alike: the Filter's switch with only `set`s, the Plate's
 * gains each held at the switch and ramped across `INSERT_SWITCH_FADE_S`
 * (windsor#629). While it holds, the spec's switch changes nothing; its
 * release writes the spec's switch back, and removing the insert drops the
 * lane.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { lane, point } from '../__fixtures__/automationRig';
import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FakeOfflineContext } from '../__fixtures__/fakeOfflineContext';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  FULL_STRIPS,
  withDocumentPart,
} from '../__fixtures__/fullArrangement';
import { GROUP_FIRST, GROUP_TICK, groupLaneRig, groupLaneSong } from '../__fixtures__/groupLaneRig';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { sources } from '../__fixtures__/stripRig';
import type { AutomationLane } from '../automation/automationLane';
import { DEFAULT_FILTER } from '../inserts/filterSpec';
import { INSERT_SWITCH_FADE_S } from '../inserts/insertConstants';
import type { InsertSpec, InsertStage } from '../inserts/insertRegistry';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';
import { renderPass } from '../render/renderPass';
import { planFor } from '../render/renderSong';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from './audioSystem';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const { hat } = FULL_SLOT;
const BAR = TICKS_PER_BAR;
const time = (tick: number): number => GROUP_FIRST + tick * GROUP_TICK;

const FILTER = { ...DEFAULT_FILTER, id: 'filt1' } as InsertSpec;
const PLATE = { ...DEFAULT_PLATE_REVERB, id: 'plate1' } as InsertSpec;
const INSERTS = [FILTER, PLATE];
/** On from the start, off over bar 2, on again at bar 3. */
const toggle = (insertId: string): AutomationLane =>
  lane(`insert.${insertId}.enabled`, [point(0, 1), point(BAR, 0), point(2 * BAR, 1)]);
const LANES = [toggle('filt1'), toggle('plate1')];

/** The switch's params on a chain: the Filter's `enabled`, the Plate's gate and bypass gains. */
interface Switches {
  readonly filter: FakeParam;
  readonly gate: FakeParam;
  readonly bypass: FakeParam;
}

function switchesOf(stages: readonly InsertStage<InsertSpec>[]): Switches {
  const filter = stages.find((s) => s.kind === 'filter')!;
  const plate = stages.find((s) => s.kind === 'plate')!;
  // The Plate's output hears its gate, then its bypass.
  const [gate, bypass] = sources(plate.output) as unknown as { gain: FakeParam }[];
  return {
    filter: filter.processor!.parameters.get('enabled') as unknown as FakeParam,
    gate: gate!.gain,
    bypass: bypass!.gain,
  };
}

/** Past a tick's time by more than the transport's summed rounding, far less than a tick. */
const EPSILON = 1e-6;

/** Each switch on (1) or off (0) at `tick`, once the Plate's fade from a switch there is over. */
const stateAt = (s: Switches, tick: number) => {
  const at = time(tick) + INSERT_SWITCH_FADE_S + EPSILON;
  return { filter: s.filter.valueAt(at), gate: s.gate.valueAt(at), bypass: s.bypass.valueAt(at) };
};
const ON = { filter: 1, gate: 1, bypass: 0 };
const OFF = { filter: 0, gate: 0, bypass: 1 };

/** The calls of `call` on `param`, by time. */
const timesOf = (param: FakeParam, call: string): number[] =>
  param.automation.filter((e) => e.call === call).map((e) => e.time!);

/**
 * Off over bar 2, on either side. The Filter's switch only steps (its
 * worklet fades itself); the Plate's gate and bypass hold at each switch and
 * ramp across the fade (windsor#629), and nowhere else.
 */
function expectToggled(s: Switches): void {
  for (const tick of [0, BAR / 2, BAR - 1]) expect(stateAt(s, tick), `tick ${tick}`).toEqual(ON);
  for (const tick of [BAR, BAR + 1, 2 * BAR - 1]) {
    expect(stateAt(s, tick), `tick ${tick}`).toEqual(OFF);
  }
  for (const tick of [2 * BAR, 3 * BAR - 1]) expect(stateAt(s, tick), `tick ${tick}`).toEqual(ON);
  expect(timesOf(s.filter, 'linearRampToValueAtTime')).toEqual([]);
  const switches = [BAR, 2 * BAR].map(time);
  for (const param of [s.gate, s.bypass]) {
    // Two calls a switch: the hold at it (a set, or a ramp to the value held), then the fade.
    const calls = param.automation;
    expect(calls).toHaveLength(2 * switches.length);
    switches.forEach((at, i) => {
      expect(calls[2 * i]!.time).toBeCloseTo(at, 9);
      expect(calls[2 * i + 1]!.call).toBe('linearRampToValueAtTime');
      expect(calls[2 * i + 1]!.time).toBeCloseTo(at + INSERT_SWITCH_FADE_S, 9);
    });
  }
}

/** The fixture song with the hat's chain and lanes. */
const partSong = (automation: readonly AutomationLane[] = LANES): ArrangementDocument =>
  withDocumentPart(FULL_DOCUMENT, 'hat', {
    strip: { ...FULL_STRIPS.hat, inserts: INSERTS },
    automation,
  });

/** The live system on `document`, every re-wire run at once; pump it with `play`. */
async function live(document: ArrangementDocument) {
  const context = new FakeContext();
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  const play = (until: number): void => {
    for (let t = context.currentTime; t <= until; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    context.currentTime = until;
  };
  const chain = () => sys.strip(musicPartName(hat))!.inserts;
  return { sys, context, play, chain };
}

describe('a switch lane on a part strip', () => {
  it('turns a Filter and a Plate off over bar 2 and back on at bar 3', async () => {
    const r = await live(partSong());
    r.sys.startMusic();
    r.play(time(3 * BAR));
    expectToggled(switchesOf(r.chain()));
  });

  it('holds while the spec switches, and the release writes the spec back', async () => {
    const r = await live(partSong());
    r.sys.startMusic();
    r.play(time(BAR / 2));
    const s = switchesOf(r.chain());
    const off = [
      { ...FILTER, enabled: false },
      { ...PLATE, enabled: false },
    ];
    expect(r.sys.apply({ parts: { [hat]: { strip: { inserts: off } } } }).ok).toBe(true);
    r.play(time(BAR - 2));
    expect(stateAt(s, BAR - 2)).toEqual(ON);
    // The lanes off: each switch goes back to its spec, which is off now.
    const now = r.context.currentTime;
    const lanesOff = LANES.map((l) => ({ ...l, on: false }));
    expect(r.sys.apply({ parts: { [hat]: { automation: lanesOff } } }).ok).toBe(true);
    expect(s.filter.automation.at(-1)).toMatchObject({ call: 'setValueAtTime', time: now });
    // The Plate's gains hold where the lane left them and cross the fade (windsor#629).
    expect(s.gate.automation.slice(-2)).toMatchObject([
      { call: 'setValueAtTime', value: 1, time: now },
      { call: 'linearRampToValueAtTime', value: 0, time: now + INSERT_SWITCH_FADE_S },
    ]);
    expect(s.bypass.automation.slice(-2)).toMatchObject([
      { call: 'setValueAtTime', value: 0, time: now },
      { call: 'linearRampToValueAtTime', value: 1, time: now + INSERT_SWITCH_FADE_S },
    ]);
    expect([s.filter.value, s.gate.value, s.bypass.value]).toEqual([0, 0, 1]);
  });

  it('drops the lane with its insert, and leaves the switch it held to the spec', async () => {
    const r = await live(partSong());
    r.sys.startMusic();
    r.play(time(BAR + 4));
    const s = switchesOf(r.chain());
    expect(stateAt(s, BAR + 4)).toEqual(OFF);
    expect(r.sys.apply({ parts: { [hat]: { strip: { inserts: [FILTER] } } } }).ok).toBe(true);
    expect(r.sys.automationLanes(hat).map((l) => l.target)).toEqual([LANES[0]!.target]);
    r.play(time(3 * BAR));
    expect(r.chain().map((stage) => stage.kind)).toEqual(['filter']);
  });
});

describe('a switch lane on a group bus', () => {
  it.each([
    ['with members', [FULL_SLOT.kick, hat]],
    ['with no members', []],
  ])('turns a Filter and a Plate off over bar 2, %s', async (_, members) => {
    const song = groupLaneSong({ group: { inserts: INSERTS, automation: LANES }, members });
    const r = await groupLaneRig(song);
    r.sys.startMusic();
    r.play(time(3 * BAR));
    expectToggled(switchesOf(r.bus().inserts));
  });
});

type Call = FakeParam['automation'][number];
type Chains = (sys: AudioSystem) => readonly (readonly InsertStage<InsertSpec>[])[];
const RATE = 8000;

/** Every switch param on `chains`, in order. */
const switchParams = (chains: ReturnType<Chains>): FakeParam[] =>
  chains.map(switchesOf).flatMap((s) => [s.filter, s.gate, s.bypass]);

/** Each chain's switch events from an offline render of `document`, before its end. */
async function offline(document: ArrangementDocument, chains: Chains): Promise<Call[][]> {
  const plan = planFor(document, { sampleRate: RATE, tailSeconds: 0 });
  let params: FakeParam[] = [];
  await renderPass(
    document,
    plan,
    { sampleRate: RATE, createContext: (init) => new FakeOfflineContext(init) },
    {
      channels: 2,
      attach: (system) => {
        params = switchParams(chains(system));
        return () => {};
      },
    },
  );
  return params.map((p) => p.automation.filter((c) => c.time! < plan.endSeconds - 1e-9));
}

describe('a switch lane in an offline render', () => {
  it('schedules what live playback does, on a part strip and on a group bus', async () => {
    const group = groupLaneSong({ group: { inserts: INSERTS, automation: LANES } });
    const document: ArrangementDocument = {
      ...group,
      parts: group.parts.map((part) =>
        part.slot === hat
          ? { ...part, strip: { ...part.strip, inserts: INSERTS }, automation: LANES }
          : part,
      ),
    };
    const chains: Chains = (sys) => [
      sys.strip(musicPartName(hat))!.inserts,
      sys.groupBus(group.groups![0]!.id)!.inserts,
    ];
    const rendered = await offline(document, chains);
    const r = await live(document);
    r.sys.startMusic();
    const end = planFor(document, { sampleRate: RATE, tailSeconds: 0 }).endSeconds;
    r.play(end);
    const played = switchParams(chains(r.sys)).map((p) =>
      p.automation.filter((c) => c.time! < end - 1e-9),
    );
    expect(rendered.every((calls) => calls.length > 2)).toBe(true);
    expect(rendered).toEqual(played);
  });
});
