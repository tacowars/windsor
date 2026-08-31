/**
 * `AudioSystem` over the document model (issue #75): `initMusic` builds only
 * the parts the document defines, landing each on the document's strip
 * overlay where the `mix` section names it; `apply` takes a deep partial of
 * the same model — arrangement fields through the player, `mix` straight onto
 * the live strips — changing only the fields it names, never half-applying.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from './__fixtures__/fakeAudioContext';
import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';
import { MIX } from './mix';

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
      ...FULL_ARRANGEMENT,
      mix: { hat: { level: 0.25, pan: -0.5, sends: { echo: 0.1 } } },
    };
    const sys = await system(doc);
    expect(sys.strip('hat')?.part.gain.value).toBe(0.25);
    expect(sys.strip('hat')?.sends.get('echo')?.gain.value).toBe(0.1);
    // A part the overlay does not name stays on the code's MIX.
    expect(sys.strip('kick')?.part.gain.value).toBe(MIX.kick.level);
  });
});

describe('apply over the document model', () => {
  it('changes only the mix fields the partial names', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    const hat = sys.strip('hat');
    const echoBefore = hat?.sends.get('echo')?.gain.value;
    expect(sys.apply({ mix: { hat: { level: 0.3 } } })).toEqual({ ok: true, ignored: [] });
    expect(hat?.part.gain.value).toBe(0.3);
    expect(hat?.sends.get('echo')?.gain.value).toBe(echoBefore);
  });

  it('sets sends live and clamps into range', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.apply({ mix: { hat: { sends: { echo: 2 } } } }).ok).toBe(true);
    expect(sys.strip('hat')?.sends.get('echo')?.gain.value).toBe(1);
  });

  it('reports unknown strips, returns and fields in ignored', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    const result = sys.apply({
      mix: { boom: { level: 1 }, hat: { wat: 3, sends: { cave: 0.5 } } },
    } as never);
    expect(result.ok).toBe(true);
    expect(result.ignored.sort()).toEqual(['mix.boom', 'mix.hat.sends.cave', 'mix.hat.wat']);
  });

  it('does not touch the mix when the arrangement half fails validation', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    const before = sys.strip('hat')?.part.gain.value;
    const result = sys.apply({ arp: { preset: 'nope' }, mix: { hat: { level: 0.1 } } });
    expect(result.ok).toBe(false);
    expect(sys.strip('hat')?.part.gain.value).toBe(before);
  });

  it('applies arrangement fields and mix fields from one partial', async () => {
    const sys = await system(FULL_ARRANGEMENT);
    expect(sys.apply({ bpm: 90, mix: { kick: { pan: 0.5 } } }).ok).toBe(true);
    expect(sys.readout().bpm).toBe(90);
  });
});
