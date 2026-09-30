/**
 * `AudioSystem` over the whole-music document (#435, #597): `initMusic` plays a
 * part on the document's own patch when `patches` names its preset and lands
 * the `returns` section on the live send buses (windsor#172); `apply` edits
 * patches, strips and buses live, only the fields the partial names.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FakeBiquad, FakeDelay } from '../__fixtures__/fakeAudioNodes';
import {
  FULL_DOCUMENT,
  FULL_SLOT,
  withDocumentPart,
  type FullPartId,
} from '../__fixtures__/fullArrangement';
import type { ArrangementDocument } from '../song/arrangementDocument';
import { AudioSystem } from './audioSystem';
import { musicPartName } from '../song/documentParts';
import { FmEngine } from '../synth/fmEngine';
import { DEFAULT_CHORUS } from '../inserts/chorusInsert';
import type { EchoSpec } from '../inserts/echoInsert';
import type { PlateReverbSpec } from '../inserts/plateReverbInsert';
import { RETURNS } from '../mixer/mix';
import { makePatch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import {
  DELAY_RESONANCE_DEFAULT_DB,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
} from '../audioConstants';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

async function system(document: ArrangementDocument): Promise<AudioSystem> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const sys = new AudioSystem(engine, { defer: (run) => run() });
  await sys.init();
  sys.initMusic(document);
  return sys;
}

const stripOf = (sys: AudioSystem, id: FullPartId) => sys.strip(musicPartName(FULL_SLOT[id]));

const PLATE = RETURNS.a.inserts[0] as PlateReverbSpec;
const ECHO = RETURNS.b.inserts[0] as EchoSpec;

/** The kinds on a bus's live chain, in order. */
const kindsOf = (sys: AudioSystem, bus: string): string[] =>
  sys.returnBus(bus)?.inserts.map((stage) => stage.kind) ?? [];
/** The plate worklet of Send A's first insert. */
const plateOf = (sys: AudioSystem): FakeWorkletNode =>
  sys.returnBus('a')?.inserts[0]?.processor as unknown as FakeWorkletNode;
/** The delay line of Send B's first insert: the one delay its input reaches. */
const delayOf = (sys: AudioSystem): FakeDelay => {
  const stack = [sys.returnBus('b')?.inserts[0]?.input as unknown as FakeNode];
  for (let node = stack.pop(); node; node = stack.pop()) {
    if (node instanceof FakeDelay) return node;
    stack.push(...node.outbound.map((c) => c.to).filter((to): to is FakeNode => 'outbound' in to));
  }
  throw new Error('Send B holds no delay line');
};
/** The echo's damping filter: the one node the delay line feeds. */
const dampOf = (sys: AudioSystem): FakeBiquad => {
  const next = delayOf(sys).outbound[0]?.to;
  if (!(next instanceof FakeBiquad)) throw new Error('the delay line does not feed a biquad');
  return next;
};

describe('initMusic with patches', () => {
  it('plays a part on the document patch its preset names', async () => {
    const lead = makePatch({ name: 'Doc Lead', volume: 0.31 });
    const sys = await system({
      ...withDocumentPart(FULL_DOCUMENT, 'arp', { preset: 'lead' }),
      patches: { ...FULL_DOCUMENT.patches, lead },
    });
    expect(stripOf(sys, 'arp')?.part.patch).toEqual(lead);
    // Every other part plays the snapshot the document carries for it (#562).
    expect(stripOf(sys, 'kick')?.part.patch).toEqual(PRESETS.kick);
  });

  it('plays the embedded snapshot even where the library has that id', async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      patches: { ...FULL_DOCUMENT.patches, kick: { ...PRESETS.kick!, volume: 0.05 } },
    });
    expect(stripOf(sys, 'kick')?.part.patch.volume).toBe(0.05);
  });
});

describe('apply over patches and returns', () => {
  it('pushes an edited document patch to every part playing it', async () => {
    const sys = await system({
      ...withDocumentPart(withDocumentPart(FULL_DOCUMENT, 'arp', { preset: 'lead' }), 'drone', {
        preset: 'lead',
      }),
      patches: { ...FULL_DOCUMENT.patches, lead: makePatch({ name: 'lead' }) },
    });
    expect(sys.apply({ patches: { lead: { volume: 0.12 } } })).toEqual({ ok: true, ignored: [] });
    expect(stripOf(sys, 'arp')?.part.patch.volume).toBe(0.12);
    expect(stripOf(sys, 'drone')?.part.patch.volume).toBe(0.12);
    expect(stripOf(sys, 'kick')?.part.patch.volume).toBe(PRESETS.kick?.volume);
  });

  it('adds a new patch live, so a later preset switch can name it', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ patches: { fresh: { volume: 0.2 } } }).ok).toBe(true);
    expect(sys.apply({ parts: { [FULL_SLOT.arp]: { preset: 'fresh' } } }).ok).toBe(true);
    expect(stripOf(sys, 'arp')?.part.patch.volume).toBe(0.2);
    expect(stripOf(sys, 'arp')?.part.patch.name).toBe('fresh');
  });

  it('takes a new patch and the preset switch naming it in one partial', async () => {
    const sys = await system(FULL_DOCUMENT);
    const result = sys.apply({
      patches: { fresh: { volume: 0.2 } },
      parts: { [FULL_SLOT.arp]: { preset: 'fresh' } },
    });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(stripOf(sys, 'arp')?.part.patch.volume).toBe(0.2);
  });

  it('ignores an inherited object name on the live returns path', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ returns: { constructor: { level: 0.5 } } } as never).ignored).toEqual([
      'returns.constructor',
    ]);
  });

  it('ignores a patch entry that is not an object', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ patches: { lead: 3 } } as never).ignored).toEqual(['patches.lead']);
  });
});

describe('initMusic with the send buses (windsor#172)', () => {
  it("lands each bus's level and chain settings on the live buses", async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      returns: {
        a: { level: 0.4, inserts: [{ ...PLATE, size: 2.5 }] },
        b: {
          level: 0.2,
          inserts: [{ ...ECHO, delayTime: 0.75, feedback: 0.5, damp: 1500, resonance: 6 }],
        },
      },
    });
    expect(sys.returnBus('a')?.level.value).toBe(0.4);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(2.5);
    expect(plateOf(sys).parameters.get('wet')?.value).toBe(1);
    expect(plateOf(sys).parameters.get('dry')?.value).toBe(0);
    expect(sys.returnBus('b')?.level.value).toBe(0.2);
    expect(delayOf(sys).delayTime.value).toBe(0.75);
    expect(dampOf(sys).Q.value).toBe(6);
  });

  it('keeps the code buses when the document has none', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.returnBus('a')?.spec).toEqual(RETURNS.a);
    expect(sys.returnBus('b')?.spec).toEqual(RETURNS.b);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(PLATE.size);
  });

  it("builds the document's own chains: an empty one and a mixed one", async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      returns: {
        a: { level: 0.9, inserts: [] },
        b: { level: 0.6, inserts: [ECHO, DEFAULT_CHORUS] },
      },
    });
    expect(kindsOf(sys, 'a')).toEqual([]);
    expect(kindsOf(sys, 'b')).toEqual(['echo', 'chorus']);
  });
});

describe('apply over the send buses (windsor#172)', () => {
  it('writes a settings-only chain edit onto the live stages, and a level live', async () => {
    const sys = await system(FULL_DOCUMENT);
    const stage = sys.returnBus('a')?.inserts[0];
    const sizeBefore = plateOf(sys).parameters.get('size')?.value;
    expect(
      sys.apply({ returns: { a: { inserts: [{ ...PLATE, decay: 0.3 }] }, b: { level: 9 } } }),
    ).toEqual({ ok: true, ignored: [] });
    expect(sys.returnBus('a')?.inserts[0]).toBe(stage);
    expect(plateOf(sys).parameters.get('decay')?.value).toBe(0.3);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(sizeBefore);
    expect(sys.returnBus('a')?.level.value).toBe(RETURNS.a.level);
    expect(sys.returnBus('b')?.level.value).toBe(1);
  });

  it("rebuilds one bus's chain and leaves the other bus and every strip as they were", async () => {
    const sys = await system(FULL_DOCUMENT);
    const echo = sys.returnBus('b')?.inserts[0];
    const drone = stripOf(sys, 'drone');
    expect(sys.apply({ returns: { a: { inserts: [ECHO, DEFAULT_CHORUS] } } }).ok).toBe(true);
    expect(kindsOf(sys, 'a')).toEqual(['echo', 'chorus']);
    expect(sys.returnBus('b')?.inserts[0]).toBe(echo);
    expect(stripOf(sys, 'drone')).toBe(drone);
    expect(sys.apply({ returns: { a: { inserts: [] } } }).ok).toBe(true);
    expect(kindsOf(sys, 'a')).toEqual([]);
  });

  it('moves the echo resonance live, clamped into its range (#647)', async () => {
    const sys = await system(FULL_DOCUMENT);
    const echoWith = (resonance: number) => ({
      returns: { b: { inserts: [{ ...ECHO, resonance }] } },
    });
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_DEFAULT_DB);
    expect(sys.apply(echoWith(9))).toEqual({ ok: true, ignored: [] });
    expect(dampOf(sys).Q.value).toBe(9);
    sys.apply(echoWith(99));
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_MAX_DB);
    sys.apply(echoWith(-99));
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_MIN_DB);
  });

  it('reports unknown buses, old return fields and junk by path', async () => {
    const sys = await system(FULL_DOCUMENT);
    const result = sys.apply({
      returns: {
        cave: { level: 1 },
        room: { level: 0.5 },
        a: { space: { size: 2 }, level: 'x', inserts: [{ kind: 'wah' }] },
        b: { inserts: 'none' },
      },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ignored.sort()).toEqual([
      'returns.a.inserts[0]',
      'returns.a.level',
      'returns.a.space',
      'returns.b.inserts',
      'returns.cave',
      'returns.room',
    ]);
    // The unknown kind is dropped, so Send A's chain is now empty; Send B's junk changes nothing.
    expect(kindsOf(sys, 'a')).toEqual([]);
    expect(kindsOf(sys, 'b')).toEqual(['echo']);
  });
});
