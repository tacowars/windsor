/** Master settings and the real graph: audible sums, post-insert level and lifetime (#666). */
import { afterAll, expect, it } from 'vitest';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from '../__fixtures__/fakeAudioContext';
import { fake, targets } from '../__fixtures__/stripRig';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { tones, rms, maxAbsDiff } from '../__fixtures__/audioAnalysis';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import { makePatch } from '../patch/patch';
import { DEFAULT_STRIP } from './mix';
import { DEFAULT_MASTER, normaliseMaster } from './masterSpec';
import { createMasterStrip } from './masterStrip';
const restore = installFakeAudioWorklet();
afterAll(restore);
it('defaults old songs and round-trips master controls without dropping other desk settings', () => {
  const old = makeArrangement(FULL_DOCUMENT);
  expect(old.document.master).toBeUndefined();
  const raw = { ...FULL_DOCUMENT, master: { level: 0.7, inserts: [DEFAULT_DRIVE] } };
  const first = makeArrangement(raw);
  expect(first.corrections).toEqual([]);
  expect(first.document.master).toEqual(raw.master);
  expect(makeArrangement(JSON.parse(JSON.stringify(first.document))).document).toEqual(
    first.document,
  );
  expect(normaliseMaster(undefined, new FieldNormaliser())).toEqual(DEFAULT_MASTER);
  const n = new FieldNormaliser();
  expect(normaliseMaster({ level: -1, inserts: [], wrong: true }, n).level).toBe(0);
  expect(n.corrections).toHaveLength(2);
});
it('reuses live effects on reorder, keeps output level independent, and cancels deferred edits on disposal', () => {
  const context = new FakeContext();
  const pending: (() => void)[] = [];
  const master = createMasterStrip(context.asAudioContext(), { defer: (run) => pending.push(run) });
  master.apply({ level: 0.4, inserts: [DEFAULT_DRIVE, DEFAULT_CHORUS] });
  expect(master.inserts).toHaveLength(0);
  pending.shift()!();
  const [drive, chorus] = master.inserts;
  master.apply({ inserts: [DEFAULT_CHORUS, DEFAULT_DRIVE] });
  pending.shift()!();
  expect(master.inserts).toEqual([chorus, drive]);
  expect(master.output.gain.value).toBe(0.4);
  master.apply({ level: 0.8 });
  expect(pending).toHaveLength(0);
  expect(master.inserts).toEqual([chorus, drive]);
  master.apply({ inserts: [] });
  master.dispose();
  pending.shift()!();
  expect(targets(master.input)).toEqual([]);
  expect(targets(master.output)).toEqual([]);
});
async function render(level: number, inserts = false, sfx = false) {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine, { defer: (run) => run() });
  await system.init();
  system.masterStrip!.apply({ level, inserts: inserts ? [DEFAULT_DRIVE] : [] });
  const part = sfx
    ? system.createSfxPart('ui', 'pickup-blip')
    : system.createMusicPart('m', makePatch(), 1, { ...DEFAULT_STRIP, sends: { room: 0.4 } });
  sourceOf(part).feed = tones(440, 660, 0.2);
  const [out, room] = renderGraph(context, 0.2, [
    fake(engine.master),
    fake(system.returnBus('room')!.output),
  ]);
  const result = { out: out!, room: room!, context, system };
  return result;
}
it('scales the complete music sum, after distortion, without changing return input or dry SFX', async () => {
  const full = await render(1, true);
  const half = await render(0.5, true);
  expect(rms(full.out.left)).toBeGreaterThan(0.01);
  expect(rms(half.out.left) / rms(full.out.left)).toBeCloseTo(0.5, 6);
  expect(maxAbsDiff(full.room.left, half.room.left)).toBe(0);
  const sfx = await render(1, false, true);
  const mutedMaster = await render(0, false, true);
  expect(maxAbsDiff(sfx.out.left, mutedMaster.out.left)).toBe(0);
  for (const item of [full, half, sfx, mutedMaster]) item.system.dispose();
});
it('lands document and live master changes on the running system without restarting parts', async () => {
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await system.init();
  system.initMusic({ ...FULL_DOCUMENT, master: { level: 0.6, inserts: [DEFAULT_DRIVE] } });
  const part = system.engine.getPart('music-0');
  expect(system.masterStrip!.spec.level).toBe(0.6);
  expect(system.apply({ master: { level: 0.3 } }).ok).toBe(true);
  expect(system.masterStrip!.output.gain.value).toBe(0.3);
  expect(system.masterStrip!.inserts).toHaveLength(1);
  expect(system.engine.getPart('music-0')).toBe(part);
  system.setMusicGain(0.2);
  expect(system.masterStrip!.output.gain.value).toBe(0.3);
  system.dispose();
});
