/**
 * `FmEngine.init()` loads the two worklet modules from the URLs Vite resolves
 * for the client, or from URLs a standalone page hands in (#70). The default
 * path must not move when the override lands.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { FakeContext, installFakeAudioWorklet } from '../__fixtures__/fakeAudioContext';
import { FmEngine } from './fmEngine';
import {
  PEAK_METER_WORKLET_URL,
  RETRO_REVERB_WORKLET_URL,
  PHASER_WORKLET_URL,
  COMPRESSOR_WORKLET_URL,
  REVERB_WORKLET_URL,
  WORKLET_URL,
} from './workletMessages';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

describe('FmEngine.init', () => {
  it('loads the fm and reverb modules from the bundled URLs, in that order', async () => {
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    expect(engine.isReady).toBe(false);

    await engine.init();

    expect(engine.isReady).toBe(true);
    expect(context.modules).toEqual([
      String(WORKLET_URL),
      String(REVERB_WORKLET_URL),
      String(COMPRESSOR_WORKLET_URL),
      String(PEAK_METER_WORKLET_URL),
      String(RETRO_REVERB_WORKLET_URL),
      String(PHASER_WORKLET_URL),
    ]);
  });

  it('loads each module once, however often init is awaited', async () => {
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    await engine.init();
    await engine.init();
    expect(context.modules).toHaveLength(6);
  });

  it('takes override URLs, together or one at a time', async () => {
    const both = new FakeContext();
    await new FmEngine(both.asAudioContext()).init({
      fmUrl: 'blob:fm',
      reverbUrl: 'blob:reverb',
      compressorUrl: 'blob:compressor',
      meterUrl: 'blob:meter',
      retroReverbUrl: 'blob:retro',
      phaserUrl: 'blob:phaser',
    });
    expect(both.modules).toEqual([
      'blob:fm',
      'blob:reverb',
      'blob:compressor',
      'blob:meter',
      'blob:retro',
      'blob:phaser',
    ]);

    const one = new FakeContext();
    await new FmEngine(one.asAudioContext()).init({ reverbUrl: new URL('blob:reverb') });
    expect(one.modules).toEqual([
      String(WORKLET_URL),
      'blob:reverb',
      String(COMPRESSOR_WORKLET_URL),
      String(PEAK_METER_WORKLET_URL),
      String(RETRO_REVERB_WORKLET_URL),
      String(PHASER_WORKLET_URL),
    ]);
  });

  it('refuses a part before init, but builds a native-only bus without it', () => {
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    expect(() => engine.createPart('early')).toThrow(/init\(\)/);
    const bus = engine.createBus({ filter: { type: 'highpass', frequency: 30 } });
    expect(bus.filter?.type).toBe('highpass');
  });
});

describe('FmEngine.disposePart (#629)', () => {
  it('disposes the named part and frees its name; an unknown name is a no-op', async () => {
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    await engine.init();
    const first = engine.createPart('music-3');
    expect(engine.getPart('music-3')).toBe(first);
    engine.disposePart('music-3');
    expect(engine.getPart('music-3')).toBeUndefined();
    engine.disposePart('music-3');
    const second = engine.createPart('music-3');
    expect(second).not.toBe(first);
    expect(engine.getPart('music-3')).toBe(second);
  });
});

describe('FmEngine.setLiveRetune', () => {
  it('reaches the parts that exist and the ones created after it (#629)', async () => {
    const context = new FakeContext();
    const engine = new FmEngine(context.asAudioContext());
    await engine.init();
    const posted = (name: string): unknown[] =>
      (engine.getPart(name)?.node as unknown as { posted: unknown[] }).posted;
    engine.createPart('music-0');
    engine.setLiveRetune(true);
    engine.createPart('music-3');
    const retune = { type: 'liveRetune', enabled: true };
    expect(posted('music-0')).toContainEqual(retune);
    expect(posted('music-3')).toContainEqual(retune);
    engine.setLiveRetune(false);
    engine.createPart('music-4');
    expect(posted('music-4')).not.toContainEqual(retune);
  });
});
