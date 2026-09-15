/**
 * `AudioSystem` over the document model (issue #75): `initMusic` builds only
 * the parts the document defines, landing each on the document's strip
 * overlay where the `mix` section names it; `apply` takes a deep partial of
 * the same model — arrangement fields through the player, `mix` straight onto
 * the live strips — changing only the fields it names, never half-applying.
 *
 * Since #562 the game path resolves a part's `preset` in the document's own
 * `patches` and nowhere else: the embedded snapshot is what plays, and a name
 * the document does not carry is a load error rather than a quiet fall back
 * to the library.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from './__fixtures__/fakeAudioContext';
import { FULL_ARRANGEMENT, FULL_DOCUMENT } from './__fixtures__/fullArrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';
import { MIX } from './mix';
import { clonePatch } from './patch';
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

const KICK_ONLY: ArrangementDocument = {
  seed: FULL_ARRANGEMENT.seed,
  bpm: FULL_ARRANGEMENT.bpm,
  key: FULL_ARRANGEMENT.key,
  kick: FULL_ARRANGEMENT.kick,
  patches: FULL_DOCUMENT.patches,
};

describe('initMusic over a document', () => {
  it('builds only the parts the document defines', async () => {
    const sys = await system(KICK_ONLY);
    expect(sys.strip('kick')).toBeDefined();
    expect(sys.strip('hat')).toBeUndefined();
    expect(sys.strip('arp')).toBeUndefined();
    expect(sys.strip('drone')).toBeUndefined();
  });

  it('lands a part on the document strip overlay when the mix names it', async () => {
    const doc: ArrangementDocument = {
      ...FULL_DOCUMENT,
      mix: { hat: { level: 0.25, pan: -0.5, sends: { echo: 0.1 } } },
    };
    const sys = await system(doc);
    expect(sys.strip('hat')?.part.gain.value).toBe(0.25);
    expect(sys.strip('hat')?.sends.get('echo')?.gain.value).toBe(0.1);
    // A part the overlay does not name stays on the code's MIX.
    expect(sys.strip('kick')?.part.gain.value).toBe(MIX.kick.level);
  });
});

describe('the document is the only patch table (#562)', () => {
  it('plays the embedded snapshot where the library patch of that id differs', async () => {
    const id = FULL_ARRANGEMENT.kick.preset;
    const fromLibrary = PRESETS[id];
    expect(fromLibrary?.volume).toBeGreaterThan(0);
    // The snapshot this song carries is deliberately not the library's — half
    // its level, derived here rather than pinned, so re-tuning it stays free.
    const snapshot = fromLibrary!.volume / 2;
    const embedded = { ...clonePatch(fromLibrary!), volume: snapshot, name: 'Snapshot Kick' };
    const sys = await system({
      ...FULL_DOCUMENT,
      patches: { ...FULL_DOCUMENT.patches, [id]: embedded },
    });
    expect(sys.strip('kick')?.part.patch.volume).toBe(snapshot);
    expect(sys.strip('kick')?.part.patch.name).toBe('Snapshot Kick');
    expect(snapshot).not.toBe(fromLibrary?.volume);
    // A live edit to the part lands on the document's table, not the library's.
    expect(sys.apply({ patches: { [id]: { volume: snapshot / 2 } } }).ok).toBe(true);
    expect(PRESETS[id]?.volume).toBe(fromLibrary?.volume);
  });

  it('fails the load naming the part and the id when the document omits a patch', async () => {
    const { kick, ...patches } = FULL_DOCUMENT.patches;
    expect(kick).toBeDefined();
    await expect(system({ ...FULL_DOCUMENT, patches })).rejects.toThrow(
      /^kick: the song document defines no patch "kick"/,
    );
    // And it is not the library that would have supplied it: the id is there.
    expect(PRESETS.kick).toBeDefined();
  });

  it('fails the load when the document has no patches section at all', async () => {
    const { patches, ...arrangement } = FULL_DOCUMENT;
    expect(patches).toBeDefined();
    await expect(system(arrangement)).rejects.toThrow(/defines no patch "kick"/);
  });
});

describe('apply over the document model', () => {
  it('changes only the mix fields the partial names', async () => {
    const sys = await system(FULL_DOCUMENT);
    const hat = sys.strip('hat');
    const echoBefore = hat?.sends.get('echo')?.gain.value;
    expect(sys.apply({ mix: { hat: { level: 0.3 } } })).toEqual({ ok: true, ignored: [] });
    expect(hat?.part.gain.value).toBe(0.3);
    expect(hat?.sends.get('echo')?.gain.value).toBe(echoBefore);
  });

  it('sets sends live and clamps into range', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ mix: { hat: { sends: { echo: 2 } } } }).ok).toBe(true);
    expect(sys.strip('hat')?.sends.get('echo')?.gain.value).toBe(1);
  });

  it('reports unknown strips, returns and fields in ignored', async () => {
    const sys = await system(FULL_DOCUMENT);
    const result = sys.apply({
      mix: { boom: { level: 1 }, hat: { wat: 3, sends: { cave: 0.5 } } },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ignored.sort()).toEqual(['mix.boom', 'mix.hat.sends.cave', 'mix.hat.wat']);
  });

  it('does not touch the mix when the arrangement half fails validation', async () => {
    const sys = await system(FULL_DOCUMENT);
    const before = sys.strip('hat')?.part.gain.value;
    const result = sys.apply({ arp: { preset: 'nope' }, mix: { hat: { level: 0.1 } } });
    expect(result.ok).toBe(false);
    expect(sys.strip('hat')?.part.gain.value).toBe(before);
  });

  it('applies arrangement fields and mix fields from one partial', async () => {
    const sys = await system(FULL_DOCUMENT);
    expect(sys.apply({ bpm: 90, mix: { kick: { pan: 0.5 } } }).ok).toBe(true);
    expect(sys.readout().bpm).toBe(90);
  });
});
