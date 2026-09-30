import { afterAll, describe, expect, it } from 'vitest';
import { FULL_DOCUMENT } from '../__fixtures__/fullArrangement';
import { installSidechainWorklet, sidechainRig } from '../__fixtures__/sidechainRig';
import { fake, sources, targets } from '../__fixtures__/stripRig';
import { sourceOf, renderGraph } from '../__fixtures__/fakeAudioContext';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { musicPartName } from '../song/documentParts';
import type { AudioSystem } from './audioSystem';
const restore = installSidechainWorklet();
afterAll(restore);
const comp = (track: number | null) => ({
  ...DEFAULT_COMPRESSOR,
  threshold: -30,
  ratio: 10,
  attack: 0.01,
  release: 0.1,
  sidechain: { track },
});
const strip = (system: AudioSystem, slot: number) => system.strip(musicPartName(slot))!;
const detector = (system: AudioSystem, slot: number, index = 0) =>
  strip(system, slot).inserts[index]!.detector!.input;
const external = (system: AudioSystem, slot: number, index = 0) =>
  strip(system, slot).inserts[index]!.processor!.parameters.get('external')!.value;
const route = (target: number, source: number | null) => ({
  parts: { [target]: { strip: { inserts: [comp(source)] } } },
});
describe('live post-FX routing', () => {
  it('fans out before pan and audible output to track and master compressors', async () => {
    const { system } = await sidechainRig();
    system.apply(route(1, 0));
    system.apply({
      master: { inserts: [comp(0)] },
      parts: { 0: { strip: { output: 'sidechain', level: 0.4, pan: 1 } } },
    });
    expect(sources(detector(system, 1))).toEqual([fake(strip(system, 0).head)]);
    expect(sources(system.masterStrip!.inserts[0]!.detector!.input)).toEqual([
      fake(strip(system, 0).head),
    ]);
    expect(strip(system, 0).part.gain.value).toBe(0.4);
    expect(external(system, 1)).toBe(1);
    expect(targets(strip(system, 0).head)).toHaveLength(3);
    system.dispose();
  });
  it('rejects cycles atomically, including pending routes', async () => {
    const pending: Array<() => void> = [];
    const { system } = await sidechainRig(FULL_DOCUMENT, (run) => pending.push(run));
    system.apply(route(1, 0));
    const bpm = system.scheduler.bpm;
    const level = strip(system, 0).part.gain.value;
    const bad = system.apply({
      ...route(0, 1),
      transport: { bpm: bpm + 10 },
      master: { level: 0.2 },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/cycle/);
    expect(system.scheduler.bpm).toBe(bpm);
    expect(system.masterStrip!.output.gain.value).toBe(1);
    expect(strip(system, 0).part.gain.value).toBe(level);
    pending.splice(0).forEach((run) => run());
    expect(external(system, 1)).toBe(1);
    system.dispose();
  });
  it('clears deleted sources and never silently reconnects a reused slot', async () => {
    const { system } = await sidechainRig();
    system.apply(route(1, 0));
    system.apply({ master: { inserts: [comp(0)] } });
    const old = strip(system, 0);
    expect(system.apply({ parts: { 0: null } }).ok).toBe(true);
    expect(sources(detector(system, 1))).toEqual([]);
    expect(external(system, 1)).toBe(1);
    expect(system.apply({ parts: { 0: FULL_DOCUMENT.parts[0]! } }).ok).toBe(true);
    expect(strip(system, 0)).not.toBe(old);
    expect(sources(detector(system, 1))).toEqual([]);
    expect(sources(system.masterStrip!.inserts[0]!.detector!.input)).toEqual([]);
    system.dispose();
  });
  it('reconciles repeated kinds, permutations, deferred edits and disposal', async () => {
    const pending: Array<() => void> = [];
    const { system } = await sidechainRig(FULL_DOCUMENT, (run) => pending.push(run));
    const flush = () => pending.splice(0).forEach((run) => run());
    system.apply({ parts: { 1: { strip: { inserts: [comp(0), comp(2)] } } } });
    flush();
    const first = strip(system, 1).inserts[0];
    system.apply({ parts: { 1: { strip: { inserts: [comp(2), comp(0)] } } } });
    expect(strip(system, 1).inserts[0]).toBe(first);
    expect(sources(detector(system, 1))).toEqual([fake(strip(system, 2).head)]);
    system.apply({ parts: { 1: { strip: { inserts: [DEFAULT_DRIVE, comp(0)] } } } });
    system.apply({ parts: { 1: { strip: { inserts: [comp(2), DEFAULT_DRIVE] } } } });
    flush();
    expect(sources(detector(system, 1))).toEqual([fake(strip(system, 2).head)]);
    system.apply({ parts: { 1: { strip: { inserts: [DEFAULT_DRIVE, comp(2)] } } } });
    flush();
    expect(sources(detector(system, 1, 1))).toEqual([fake(strip(system, 2).head)]);
    system.apply({ parts: { 1: { strip: { inserts: [comp(0)] } } } });
    system.dispose();
    expect(() => flush()).not.toThrow();
  });
  it('keeps deletion safe while a target is waiting for an insert fade', async () => {
    const pending: Array<() => void> = [];
    const { system } = await sidechainRig(FULL_DOCUMENT, (run) => pending.push(run));
    system.apply(route(1, 0));
    pending.splice(0).forEach((run) => run());
    system.apply({ parts: { 1: { strip: { inserts: [comp(0), DEFAULT_DRIVE] } } } });
    system.apply({ parts: { 0: null } });
    system.apply({ parts: { 0: FULL_DOCUMENT.parts[0]! } });
    pending.splice(0).forEach((run) => run());
    expect(sources(detector(system, 1))).toEqual([]);
    expect(external(system, 1)).toBe(1);
    system.dispose();
  });
  it('renders real ducking from a silent trigger, follows Level, and leaks no detector audio', async () => {
    const { system, context } = await sidechainRig();
    system.apply({
      parts: {
        0: { strip: { output: 'sidechain', sends: { room: 1, echo: 1 } } },
        1: { strip: { level: 1, inserts: [comp(0)], sends: { room: 0, echo: 0 } } },
      },
    });
    sourceOf(strip(system, 0).part).feed = (b, l, r) => {
      for (let i = 0; i < l.length; i++) l[i] = r[i] = Math.sin((b * l.length + i) * 0.1);
    };
    sourceOf(strip(system, 1).part).feed = (b, l, r) => {
      for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.2 * Math.sin((b * l.length + i) * 0.2);
    };
    const [program, trigger, send] = renderGraph(
      context,
      0.8,
      [
        fake(strip(system, 1).tail),
        fake(strip(system, 0).head),
        fake(strip(system, 0).sends.get('room')!),
      ],
      (_b, t) => {
        if (t > 0.2) strip(system, 0).setLevel(0);
        if (t > 0.65) sourceOf(strip(system, 1).part).feed = null;
      },
    );
    const rms = (v: Float32Array) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
    expect(rms(trigger!.left.slice(1000, 4000))).toBeGreaterThan(0.5);
    expect(rms(program!.left.slice(2000, 4000))).toBeLessThan(0.06);
    expect(rms(send!.left)).toBe(0);
    expect(rms(trigger!.left.slice(18000))).toBeLessThan(0.00001);
    expect(rms(program!.left.slice(24000, 28000))).toBeGreaterThan(0.1);
    expect(rms(program!.left.slice(36000))).toBeLessThan(0.001);
    system.dispose();
  });
  it('takes the detector after source inserts for both track and master targets', async () => {
    const level = async (filtered: boolean, master: boolean): Promise<number> => {
      const { system, context } = await sidechainRig();
      system.apply({
        parts: {
          0: {
            strip: {
              output: 'sidechain',
              level: 1,
              inserts: filtered ? [{ ...DEFAULT_DRIVE, mix: 1, drive: 0, tone: 200 }] : [],
            },
          },
          1: { strip: { level: 1, inserts: master ? [] : [comp(0)], sends: { room: 0, echo: 0 } } },
        },
        master: { inserts: master ? [comp(0)] : [] },
      });
      sourceOf(strip(system, 0).part).feed = (b, l, r) => {
        for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.8 * Math.sin((b * l.length + i) * 0.3);
      };
      sourceOf(strip(system, 1).part).feed = (b, l, r) => {
        for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.2 * Math.sin((b * l.length + i) * 0.1);
      };
      const [audio] = renderGraph(context, 0.3, [
        fake(master ? system.masterStrip!.output : strip(system, 1).tail),
      ]);
      const settled = audio!.left.slice(8000);
      const rms = Math.sqrt(settled.reduce((sum, x) => sum + x * x, 0) / settled.length);
      system.dispose();
      return rms;
    };
    for (const master of [false, true])
      expect(await level(true, master)).toBeGreaterThan(3 * (await level(false, master)));
  });
  it('stops new dry/send audio while the existing return tail keeps decaying', async () => {
    const { system, context } = await sidechainRig();
    system.apply({ parts: { 0: { strip: { sends: { echo: 1 } } } } });
    sourceOf(strip(system, 0).part).feed = (b, l, r) => {
      for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.4 * Math.sin((b * l.length + i) * 0.1);
    };
    const [dry, send, tail] = renderGraph(
      context,
      0.5,
      [
        fake(strip(system, 0).rotation.output),
        fake(strip(system, 0).sends.get('echo')!),
        fake(system.returnBus('echo')!.output),
      ],
      (_b, t) => {
        if (t >= 0.1) strip(system, 0).setOutput('sidechain');
      },
    );
    expect(dry!.left.slice(6000).every((v) => v === 0)).toBe(true);
    expect(send!.left.slice(6000).every((v) => v === 0)).toBe(true);
    expect(tail!.left.slice(15000).some((v) => Math.abs(v) > 0.01)).toBe(true);
    system.dispose();
  });
  it('mutes or solos another part like Sidechain only, and the key still reaches its detector', async () => {
    for (const change of [
      (system: AudioSystem) => strip(system, 0).setMute(true),
      (system: AudioSystem) => system.apply({ parts: { 1: { strip: { solo: true } } } }),
    ]) {
      const { system, context } = await sidechainRig();
      system.apply(route(1, 0));
      system.apply({ parts: { 0: { strip: { sends: { echo: 1 } } } } });
      sourceOf(strip(system, 0).part).feed = (b, l, r) => {
        for (let i = 0; i < l.length; i++) l[i] = r[i] = 0.4 * Math.sin((b * l.length + i) * 0.1);
      };
      let changed = false;
      const [dry, send, key] = renderGraph(
        context,
        0.3,
        [
          fake(strip(system, 0).rotation.output),
          fake(strip(system, 0).sends.get('echo')!),
          fake(detector(system, 1)),
        ],
        (_b, t) => {
          if (t < 0.1 || changed) return;
          changed = true;
          change(system);
        },
      );
      expect(dry!.left.slice(6000).every((v) => v === 0)).toBe(true);
      expect(send!.left.slice(6000).every((v) => v === 0)).toBe(true);
      expect(key!.left.slice(6000).some((v) => Math.abs(v) > 0.1)).toBe(true);
      system.dispose();
    }
  });
});
