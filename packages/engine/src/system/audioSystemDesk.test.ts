/**
 * `AudioSystem` over the whole-music document (#435, #597): `initMusic` plays a
 * part on the document's own patch when `patches` names its preset and lands
 * the `returns` overlay on the live buses; `apply` edits patches, strips and
 * returns live, only the fields the partial names.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import type { FakeWorkletNode } from '../__fixtures__/fakeAudioContext';
import type { FakeNode } from '../__fixtures__/fakeAudioNodes';
import { FakeBiquad } from '../__fixtures__/fakeAudioNodes';
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
  const sys = new AudioSystem(engine);
  await sys.init();
  sys.initMusic(document);
  return sys;
}

const stripOf = (sys: AudioSystem, id: FullPartId) => sys.strip(musicPartName(FULL_SLOT[id]));

const plateOf = (sys: AudioSystem): FakeWorkletNode =>
  sys.returnBus('room')?.effect as unknown as FakeWorkletNode;
const delayOf = (sys: AudioSystem): DelayNode => sys.returnBus('echo')?.effect as DelayNode;
/** The echo's damping filter: the one node the delay line feeds. */
const dampOf = (sys: AudioSystem): FakeBiquad => {
  const next = (delayOf(sys) as unknown as FakeNode).outbound[0]?.to;
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

describe('initMusic with returns', () => {
  it('lands the plate space, the return levels and the delay line on the live buses', async () => {
    const sys = await system({
      ...FULL_DOCUMENT,
      returns: {
        room: { kind: 'reverb', level: 0.4, space: { ...RETURNS.room.space, size: 2.5 } },
        echo: {
          kind: 'delay',
          level: 0.2,
          delayTime: 0.75,
          feedback: 0.5,
          damp: 1500,
          resonance: 6,
        },
      },
    });
    expect(sys.returnBus('room')?.level.value).toBe(0.4);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(2.5);
    expect(sys.returnBus('echo')?.level.value).toBe(0.2);
    expect(delayOf(sys).delayTime.value).toBe(0.75);
    expect(dampOf(sys).Q.value).toBe(6);
  });

  it('keeps the code returns when the document has no overlay', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.returnBus('room')?.level.value).toBe(RETURNS.room.level);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(RETURNS.room.space.size);
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

  it('changes only the return fields the partial names, clamped', async () => {
    const sys = await system(FULL_DOCUMENT);
    const sizeBefore = plateOf(sys).parameters.get('size')?.value;
    expect(
      sys.apply({ returns: { room: { space: { decay: 0.3 } }, echo: { feedback: 9 } } }),
    ).toEqual({
      ok: true,
      ignored: [],
    });
    expect(plateOf(sys).parameters.get('decay')?.value).toBe(0.3);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(sizeBefore);
    expect(sys.returnBus('echo')?.level.value).toBe(RETURNS.echo.level);
  });

  it('moves the echo resonance live, clamped into its range (#647)', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_DEFAULT_DB);
    expect(sys.apply({ returns: { echo: { resonance: 9 } } })).toEqual({ ok: true, ignored: [] });
    expect(dampOf(sys).Q.value).toBe(9);
    sys.apply({ returns: { echo: { resonance: 99 } } });
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_MAX_DB);
    sys.apply({ returns: { echo: { resonance: -99 } } });
    expect(dampOf(sys).Q.value).toBe(DELAY_RESONANCE_MIN_DB);
    const wrongKind = sys.apply({ returns: { room: { resonance: 3 } } } as never);
    expect(wrongKind.ignored).toEqual(['returns.room.resonance']);
  });

  it('reports unknown returns, wrong-kind fields and junk by path', async () => {
    const sys = await system(FULL_DOCUMENT);
    const result = sys.apply({
      returns: { cave: { level: 1 }, room: { delayTime: 1, space: { wat: 1 }, level: 'x' } },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ignored.sort()).toEqual([
      'returns.cave',
      'returns.room.delayTime',
      'returns.room.level',
      'returns.room.space.wat',
    ]);
  });
});
