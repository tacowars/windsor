/**
 * `AudioSystem` over the whole-music document (#435): `initMusic` plays a
 * part on the document's own patch when `patches` names its preset and lands
 * the `returns` overlay on the live buses; `apply` edits patches, strips and
 * returns live, only the fields the partial names.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from './__fixtures__/fakeAudioContext';
import type { FakeWorkletNode } from './__fixtures__/fakeAudioContext';
import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';
import { RETURNS } from './mix';
import { makePatch } from './patch';
import { PRESETS } from './presets';

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

const plateOf = (sys: AudioSystem): FakeWorkletNode =>
  sys.returnBus('room')?.effect as unknown as FakeWorkletNode;
const delayOf = (sys: AudioSystem): DelayNode => sys.returnBus('echo')?.effect as DelayNode;

describe('initMusic with patches', () => {
  it('plays a part on the document patch its preset names', async () => {
    const lead = makePatch({ name: 'Doc Lead', volume: 0.31 });
    const sys = await system({
      ...FULL_ARRANGEMENT,
      arp: { ...FULL_ARRANGEMENT.arp, preset: 'lead' },
      patches: { lead },
    });
    expect(sys.strip('arp')?.part.patch).toEqual(lead);
    // A part whose preset the document does not define stays on the built-in.
    expect(sys.strip('kick')?.part.patch).toEqual(PRESETS.kick);
  });

  it('lets a document patch shadow a built-in of the same name', async () => {
    const sys = await system({
      ...FULL_ARRANGEMENT,
      patches: { kick: { ...PRESETS.kick!, volume: 0.05 } },
    });
    expect(sys.strip('kick')?.part.patch.volume).toBe(0.05);
  });
});

describe('initMusic with returns', () => {
  it('lands the plate space, the return levels and the delay line on the live buses', async () => {
    const sys = await system({
      ...FULL_ARRANGEMENT,
      returns: {
        room: { kind: 'reverb', level: 0.4, space: { ...RETURNS.room.space, size: 2.5 } },
        echo: { kind: 'delay', level: 0.2, delayTime: 0.75, feedback: 0.5, damp: 1500 },
      },
    });
    expect(sys.returnBus('room')?.level.value).toBe(0.4);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(2.5);
    expect(sys.returnBus('echo')?.level.value).toBe(0.2);
    expect(delayOf(sys).delayTime.value).toBe(0.75);
  });

  it('keeps the code returns when the document has no overlay', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.returnBus('room')?.level.value).toBe(RETURNS.room.level);
    expect(plateOf(sys).parameters.get('size')?.value).toBe(RETURNS.room.space.size);
  });
});

describe('apply over patches and returns', () => {
  it('pushes an edited document patch to every part playing it', async () => {
    const sys = await system({
      ...FULL_ARRANGEMENT,
      arp: { ...FULL_ARRANGEMENT.arp, preset: 'lead' },
      drone: { ...FULL_ARRANGEMENT.drone, preset: 'lead' },
      patches: { lead: makePatch({ name: 'lead' }) },
    });
    expect(sys.apply({ patches: { lead: { volume: 0.12 } } })).toEqual({ ok: true, ignored: [] });
    expect(sys.strip('arp')?.part.patch.volume).toBe(0.12);
    expect(sys.strip('drone')?.part.patch.volume).toBe(0.12);
    expect(sys.strip('kick')?.part.patch.volume).toBe(PRESETS.kick?.volume);
  });

  it('adds a new patch live, so a later preset switch can name it', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.apply({ patches: { fresh: { volume: 0.2 } } }).ok).toBe(true);
    expect(sys.apply({ arp: { preset: 'fresh' } }).ok).toBe(true);
    expect(sys.strip('arp')?.part.patch.volume).toBe(0.2);
    expect(sys.strip('arp')?.part.patch.name).toBe('fresh');
  });

  it('takes a new patch and the preset switch naming it in one partial', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    const result = sys.apply({ patches: { fresh: { volume: 0.2 } }, arp: { preset: 'fresh' } });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(sys.strip('arp')?.part.patch.volume).toBe(0.2);
  });

  it('ignores an inherited object name on the live returns path', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.apply({ returns: { constructor: { level: 0.5 } } } as never).ignored).toEqual([
      'returns.constructor',
    ]);
  });

  it('ignores a patch entry that is not an object', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.apply({ patches: { lead: 3 } } as never).ignored).toEqual(['patches.lead']);
  });

  it('changes only the return fields the partial names, clamped', async () => {
    const sys = await system(FULL_ARRANGEMENT);
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

  it('reports unknown returns, wrong-kind fields and junk by path', async () => {
    const sys = await system(FULL_ARRANGEMENT);
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
