/**
 * The Filter insert's lanes (windsor#622 decision 7): Cutoff (log, Hz),
 * Reso and Mix play on a part's strip and on a group's bus through the
 * stage's params, tracing each lane's curve; the mode, the slope and the
 * switch have no rows.
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
import { GROUP_FIRST, GROUP_TICK, groupLaneRig, groupLaneSong } from '../__fixtures__/groupLaneRig';
import { ENGINE_WORKLETS, installParamWorklet } from '../__fixtures__/insertParamRig';
import { valueAt } from '../automation/automationEvaluate';
import { insertTargetRow } from '../automation/automationTargets';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import type { InsertSpec } from './insertRegistry';
import { DEFAULT_FILTER } from './filterSpec';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

const FILTER = { ...DEFAULT_FILTER, id: 'filt1' } as InsertSpec;
const SONG = 384;
const LANES = [
  lane('insert.filt1.cutoff', [point(0, 200), point(SONG, 8000)]),
  lane('insert.filt1.resonance', [point(0, 0.707), point(SONG, 9)]),
  lane('insert.filt1.mix', [point(0, 1), point(SONG, 0.3)]),
];
const time = (tick: number): number => GROUP_FIRST + tick * GROUP_TICK;

/** Each lane's param traces its curve over the first ticks. */
function expectTraced(param: (field: string) => FakeParam): void {
  for (const l of LANES) {
    const field = l.target.split('.').at(-1)!;
    const row = insertTargetRow('filter', field)!;
    const p = param(field);
    expect(p.automation.length, field).toBeGreaterThan(30);
    for (let tick = 1; tick < 30; tick++)
      expect(p.valueAt(time(tick)), field).toBeCloseTo(valueAt(row, l.points, tick), 6);
  }
}

describe('Filter lanes', () => {
  it('has rows for the sweep and the switch: Cutoff in Hz, Reso on a log scale, Mix, On', () => {
    expect(insertTargetRow('filter', 'cutoff')).toMatchObject({
      min: 30,
      max: 18000,
      scale: 'log',
      unit: 'Hz',
    });
    expect(insertTargetRow('filter', 'resonance')).toMatchObject({ scale: 'log' });
    expect(insertTargetRow('filter', 'mix')).toMatchObject({ min: 0, max: 1, scale: 'linear' });
    expect(insertTargetRow('filter', 'enabled')).toMatchObject({ scale: 'switch', label: 'On' });
    for (const field of ['mode', 'slope24'])
      expect(insertTargetRow('filter', field), field).toBeUndefined();
  });

  it("sweep a part strip's Filter", async () => {
    const { hat } = FULL_SLOT;
    const context = new FakeContext();
    const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
    await sys.init();
    const strip = { ...FULL_STRIPS.hat, inserts: [FILTER] };
    sys.initMusic(withDocumentPart(FULL_DOCUMENT, 'hat', { strip, automation: LANES }));
    sys.startMusic();
    for (let t = 0; t <= 1; t += 0.025) {
      context.currentTime = t;
      sys.update(0);
    }
    const stage = sys.strip(musicPartName(hat))!.inserts.find((s) => s.kind === 'filter')!;
    expectTraced((field) => stage.processor!.parameters.get(field) as unknown as FakeParam);
  });

  it("sweep a group bus's Filter", async () => {
    const r = await groupLaneRig(
      groupLaneSong({ group: { inserts: [FILTER], automation: LANES } }),
    );
    r.sys.startMusic();
    r.play(1);
    expectTraced((field) => r.insertParam('filter', field));
  });
});
