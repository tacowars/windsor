/**
 * The song's key reaching the inserts (windsor#717): the registry hands a new
 * stage the current key and forwards a change of root or scale to the live
 * ones, and nothing else; the song's chord (windsor#729) is forwarded to every
 * live stage that takes one, and each new one is announced. On the live system, every bloom on Song key follows
 * the song's key on a part strip, a group, a return and the master, a bloom
 * on a fixed scale doesn't, and one added after the song loaded starts on it.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import type { FakeParam } from '../__fixtures__/fakeAudioNodes';
import { FULL_DOCUMENT, FULL_SLOT, FULL_STRIPS } from '../__fixtures__/fullArrangement';
import {
  ENGINE_WORKLETS,
  installParamWorklet,
  type ParamWorkletNode,
} from '../__fixtures__/insertParamRig';
import type { Harmony } from '../harmony/harmonyTimeline';
import { SCALES } from '../sequencing/scaleSampler';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { FmEngine } from '../synth/fmEngine';
import { AudioSystem } from '../system/audioSystem';
import { BLOOM_NAME, BLOOM_PITCHES_ALL } from './bloomConstants';
import { pitchMask } from './bloomPitches';
import { DEFAULT_BLOOM } from './bloomSpec';
import type { BloomSpec } from './bloomSpec';
import { harmonyInsertRegistry } from './harmonyInsertRegistry';
import type { InsertRegistry, InsertSpec, InsertStage } from './insertRegistry';
import { tempoInsertRegistry } from './tempoInsertRegistry';

const restore = installParamWorklet(ENGINE_WORKLETS);
afterAll(() => restore());

type Stage = InsertStage<InsertSpec>;

/** A source of two kinds: `keyed` takes the song's key and tempo, `plain` neither. */
function source() {
  const made: { keyed: Stage[]; plain: Stage[] } = { keyed: [], plain: [] };
  const stage = (kind: 'keyed' | 'plain'): Stage => {
    const base = {
      kind,
      input: {} as AudioNode,
      output: {} as AudioNode,
      set: vi.fn(),
      dispose: vi.fn(),
    };
    const keyed = { ...base, setHarmony: vi.fn(), setTempo: vi.fn(), setChord: vi.fn() };
    return (kind === 'keyed' ? keyed : base) as unknown as Stage;
  };
  const kind = (name: 'keyed' | 'plain') =>
    ({
      fields: ['kind'],
      defaults: { kind: name },
      normalise: () => ({ kind: name }),
      create: () => {
        const made1 = stage(name);
        made[name].push(made1);
        return made1;
      },
    }) as unknown as InsertRegistry[string];
  const registry: InsertRegistry = { keyed: kind('keyed'), plain: kind('plain') };
  return { registry, made };
}

const context = {} as BaseAudioContext;
const create = (registry: InsertRegistry, name: string): Stage =>
  registry[name]!.create(context, { kind: name } as unknown as InsertSpec);

describe('harmonyInsertRegistry', () => {
  it('hands no key before the first, then the current key at creation, and forwards a change', () => {
    const { registry: src, made } = source();
    const harmony = harmonyInsertRegistry(src);
    create(harmony.registry, 'keyed');
    const early = made.keyed[0]!;
    expect(early.setHarmony).not.toHaveBeenCalled();
    harmony.setHarmony(2, 'dorian');
    expect(early.setHarmony).toHaveBeenLastCalledWith(2, 'dorian');
    create(harmony.registry, 'keyed');
    expect(made.keyed[1]!.setHarmony).toHaveBeenCalledExactlyOnceWith(2, 'dorian');
    harmony.setHarmony(7, [0, 3, 7]);
    for (const stage of made.keyed) expect(stage.setHarmony).toHaveBeenLastCalledWith(7, [0, 3, 7]);
  });

  it('forwards nothing when neither the root nor the scale changed', () => {
    const { registry: src, made } = source();
    const harmony = harmonyInsertRegistry(src);
    create(harmony.registry, 'keyed');
    const stage = made.keyed[0]!;
    harmony.setHarmony(2, 'dorian');
    harmony.setHarmony(2, 'dorian');
    harmony.setHarmony(2, [0, 2, 4]);
    // A fresh array with the same offsets is the same scale.
    harmony.setHarmony(2, [0, 2, 4]);
    expect(stage.setHarmony).toHaveBeenCalledTimes(2);
    harmony.setHarmony(2, [0, 2, 5]);
    harmony.setHarmony(3, [0, 2, 5]);
    expect(stage.setHarmony).toHaveBeenCalledTimes(4);
  });

  it('forgets a disposed stage, and leaves a kind without setHarmony unwrapped', () => {
    const { registry: src, made } = source();
    const harmony = harmonyInsertRegistry(src);
    create(harmony.registry, 'keyed').dispose();
    expect(made.keyed[0]!.dispose).toHaveBeenCalledOnce();
    harmony.setHarmony(5, 'major');
    expect(made.keyed[0]!.setHarmony).not.toHaveBeenCalled();
    expect(create(harmony.registry, 'plain')).toBe(made.plain[0]);
  });

  it('forwards a chord to every live stage that takes one, and announces each new one', () => {
    const { registry: src, made } = source();
    const added = vi.fn();
    const harmony = harmonyInsertRegistry(src, added);
    create(harmony.registry, 'keyed');
    create(harmony.registry, 'plain');
    const gone = create(harmony.registry, 'keyed');
    expect(added).toHaveBeenCalledTimes(2);
    gone.dispose();
    harmony.setChord(0b10010001, 1.5, true);
    expect(made.keyed[0]!.setChord).toHaveBeenCalledExactlyOnceWith(0b10010001, 1.5, true);
    expect(made.keyed[1]!.setChord).not.toHaveBeenCalled();
  });

  it('composes with the tempo registry, so a stage takes both', () => {
    const { registry: src, made } = source();
    const harmony = harmonyInsertRegistry(src);
    const tempo = tempoInsertRegistry(120, harmony.registry);
    harmony.setHarmony(9, 'naturalMinor');
    const stage = create(tempo.registry, 'keyed');
    const inner = made.keyed[0]!;
    expect(inner.setTempo).toHaveBeenCalledWith(120);
    expect(inner.setHarmony).toHaveBeenCalledWith(9, 'naturalMinor');
    tempo.setTempo(90);
    harmony.setHarmony(0, 'major');
    expect(inner.setTempo).toHaveBeenLastCalledWith(90);
    expect(inner.setHarmony).toHaveBeenLastCalledWith(0, 'major');
    stage.dispose();
    tempo.setTempo(100);
    harmony.setHarmony(1, 'major');
    expect(inner.setTempo).toHaveBeenCalledTimes(2);
    expect(inner.setHarmony).toHaveBeenCalledTimes(2);
  });
});

/** Blooms told apart by their Low note, which nothing here changes. */
const SITES = { part: 41, group: 42, ret: 43, master: 44, fixed: 45, added: 46 } as const;
const bloom = (low: number, scale: BloomSpec['scale'] = 'song'): InsertSpec =>
  ({ ...DEFAULT_BLOOM, id: `bloom${low}`, low, key: 'F', scale }) as InsertSpec;

async function live(harmony: Harmony = FULL_DOCUMENT.harmony) {
  const context = new FakeContext();
  const sys = new AudioSystem(new FmEngine(context.asAudioContext()), { defer: (run) => run() });
  await sys.init();
  const { kick, hat } = FULL_SLOT;
  const document: ArrangementDocument = {
    ...FULL_DOCUMENT,
    harmony,
    groups: [{ id: 0, name: 'Drums', level: 1, pan: 0, inserts: [bloom(SITES.group)] }],
    parts: FULL_DOCUMENT.parts.map((part) =>
      part.slot === kick
        ? {
            ...part,
            strip: { ...FULL_STRIPS.kick, inserts: [bloom(SITES.part)], output: { group: 0 } },
          }
        : part.slot === hat
          ? { ...part, strip: { ...FULL_STRIPS.hat, inserts: [bloom(SITES.fixed, 'dorian')] } }
          : part,
    ),
    returns: { a: { level: 1, inserts: [bloom(SITES.ret)] } },
    master: { level: 1, inserts: [bloom(SITES.master)] },
  };
  sys.initMusic(document);
  /** The newest bloom processor with Low at `low`: its pitch set. */
  const pitches = (low: number): number => {
    const node = context.nodes
      .filter((n) => (n as Partial<ParamWorkletNode>).name === BLOOM_NAME)
      .map((n) => n as unknown as ParamWorkletNode)
      .filter((n) => n.parameters.get('low').value === low)
      .at(-1);
    return (node!.parameters.get('pitches') as FakeParam).value;
  };
  return { sys, pitches };
}

describe('Song key on the live system', () => {
  const D_DORIAN = pitchMask(2, SCALES.dorian);
  const F_DORIAN = pitchMask(5, SCALES.dorian);
  const SONG_SITES = [SITES.part, SITES.group, SITES.ret, SITES.master];

  it("plays the song's key everywhere, and follows a live edit of its root or scale", async () => {
    const { sys, pitches } = await live();
    for (const site of SONG_SITES) expect(pitches(site), `${site}`).toBe(D_DORIAN);
    expect(pitches(SITES.fixed)).toBe(F_DORIAN);
    expect(sys.apply({ harmony: { root: 7 } }).ok).toBe(true);
    for (const site of SONG_SITES) expect(pitches(site)).toBe(pitchMask(7, SCALES.dorian));
    expect(sys.apply({ harmony: { scale: 'major' } }).ok).toBe(true);
    for (const site of SONG_SITES) expect(pitches(site)).toBe(pitchMask(7, SCALES.major));
    expect(pitches(SITES.fixed)).toBe(F_DORIAN);
  });

  it("folds a custom scale's offsets", async () => {
    const { pitches } = await live({ ...FULL_DOCUMENT.harmony, root: 4, scale: [0, 3, 7, 14, -2] });
    // E, G, B, F# (14 folds to 2), D (−2 folds to 10): pitch classes 4 7 11 6 2.
    expect(pitches(SITES.master)).toBe(0b100011010100);
  });

  it('starts a bloom added after the song loaded on the current key', async () => {
    const { sys, pitches } = await live();
    sys.apply({ harmony: { root: 9 } });
    const { arp } = FULL_SLOT;
    const strip = { ...FULL_STRIPS.arp, inserts: [bloom(SITES.added)] };
    expect(sys.apply({ parts: { [arp]: { strip } } }).ok).toBe(true);
    expect(pitches(SITES.added)).toBe(pitchMask(9, SCALES.dorian));
    expect(pitches(SITES.added)).not.toBe(BLOOM_PITCHES_ALL);
  });
});
