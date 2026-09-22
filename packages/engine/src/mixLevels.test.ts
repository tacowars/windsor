/**
 * The settings' two channels against the real routing (#518 decision 1),
 * headless: `AudioSystem` and `FmEngine` run unchanged on the graph stand-in
 * and the plate return is the real `reverb-processor.js`, so what is asserted
 * here is what a browser renders.
 *
 * The load-bearing case is the last one: at the shipped defaults the samples
 * are *identical* to a page with no settings at all (decision 6), which is
 * the promise made to a player who never opens the panel.
 */
import { afterAll, describe, expect, it } from 'vitest';

import { burst, maxAbsDiff, rms, tones } from './__fixtures__/audioAnalysis';
import type { Capture } from './__fixtures__/fakeAudioContext';
import {
  FakeContext,
  installFakeAudioWorklet,
  renderGraph,
  sourceOf,
} from './__fixtures__/fakeAudioContext';
import type { FakeNode } from './__fixtures__/fakeAudioNodes';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';
import type { ChannelStrip } from './mix';
import { SPATIAL_SFX_UNITY, createMixLevels, spatialVolumeFor } from './mixLevels';
import { SFX_LIMITS } from './sfxConstants';
import { PRESETS } from './presets';
import { LOW_CUT_MIN_HZ } from './audioConstants';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

const fake = (node: AudioNode): FakeNode => node as unknown as FakeNode;
const SIGNAL = burst(tones(440, 440, 0.5), 0.3);
const SECONDS = 1.2;
/** A music part with a real send, so the dry path and the room are both in play. */
const MUSIC_STRIP: ChannelStrip = {
  level: 1,
  pan: 0,
  lowCut: LOW_CUT_MIN_HZ,
  sends: { room: 0.4 },
};
const SFX_STRIP: ChannelStrip = { level: 1, pan: 0, lowCut: LOW_CUT_MIN_HZ, sends: {} };

interface Render {
  master: Capture;
  room: Capture;
  system: AudioSystem;
}

interface RenderOptions {
  /** Omit to build no mixer at all — the page as it is without settings. */
  levels?: { music?: number; sfx?: number };
  /** Which parts exist; both, unless a case needs one path on its own. */
  parts?: { music?: boolean; sfx?: boolean };
}

/** Build the parts, set the levels (or none at all), render the master and the room. */
async function render({ levels, parts }: RenderOptions = {}): Promise<Render> {
  const context = new FakeContext();
  const engine = new FmEngine(context.asAudioContext());
  const system = new AudioSystem(engine, { mix: { m: MUSIC_STRIP, s: SFX_STRIP } });
  await system.init();
  if (levels) {
    const mix = createMixLevels(system);
    if (levels.music !== undefined) mix.setMusicLevel(levels.music);
    if (levels.sfx !== undefined) mix.setSfxLevel(levels.sfx);
  }
  if (parts?.music !== false)
    sourceOf(system.createMusicPart('m', PRESETS['pad-drift']!)).feed = SIGNAL;
  if (parts?.sfx !== false) sourceOf(system.createSfxPart('s', 'pickup-blip')).feed = SIGNAL;
  const room = system.returnBus('room');
  if (!room) throw new Error('no room return');
  const [master, roomOut] = renderGraph(context, SECONDS, [fake(engine.master), fake(room.output)]);
  if (!master || !roomOut) throw new Error('render produced no captures');
  return { master, room: roomOut, system };
}

describe('the music channel', () => {
  it('is the music bus fader, and halves what the master hears', async () => {
    const full = await render({ levels: { music: 1 } });
    const half = await render({ levels: { music: 0.5 } });
    expect(full.system.musicGain).toBe(1);
    expect(half.system.musicGain).toBe(0.5);
    expect(rms(full.master.left)).toBeGreaterThan(1e-3);
    // The SFX part is on the same master and does not move, so the drop is
    // less than half; what matters is that it dropped and by how much the
    // music contributes.
    expect(rms(half.master.left)).toBeLessThan(rms(full.master.left));
  });

  it('takes the returns down with it: the room is still fed, and none of it is heard', async () => {
    const silent = await render({ levels: { music: 0, sfx: 0 } });
    // The send taps the part post-fader and pre-bus, so the plate is still
    // ringing — it is the return's landing on the music fader, not a dead
    // send, that makes the master silent (decision 1).
    expect(rms(silent.room.left)).toBeGreaterThan(1e-4);
    expect(rms(silent.master.left)).toBeLessThan(1e-9);
    expect(rms(silent.master.right)).toBeLessThan(1e-9);
  });

  it('leaves the SFX path alone', async () => {
    const sfxOnly = { parts: { music: false } };
    const loud = await render({ ...sfxOnly, levels: { music: 1 } });
    const muted = await render({ ...sfxOnly, levels: { music: 0 } });
    expect(rms(loud.master.left)).toBeGreaterThan(1e-3);
    // Not bit-identical only because the plate's anti-denormal floor is on
    // the music fader now and the fader is zero in one of the two renders;
    // ~1e-21 is 17 orders of magnitude below the signal being compared.
    expect(maxAbsDiff(loud.master.left, muted.master.left)).toBeLessThan(1e-18);
  });
});

describe('the SFX channel', () => {
  it('moves the SFX strips and silences them at 0', async () => {
    const full = await render({ levels: { music: 0, sfx: 1 } });
    const half = await render({ levels: { music: 0, sfx: 0.5 } });
    const off = await render({ levels: { music: 0, sfx: 0 } });
    expect(rms(half.master.left)).toBeCloseTo(rms(full.master.left) * 0.5, 6);
    expect(rms(off.master.left)).toBeLessThan(1e-9);
  });

  it('drives the spatial engine from the same value, at its own unity', () => {
    const calls: number[] = [];
    const graph = { setMusicGain: (): void => {}, setSfxGain: (): void => {} };
    const mix = createMixLevels(graph);

    // Attaching applies the level already held — what `createGameplaySfx`
    // relies on between constructing the engine and the first sound.
    mix.setSfxLevel(0.5);
    mix.attachSpatial({ setVolume: (v) => calls.push(v) });
    expect(calls).toEqual([spatialVolumeFor(0.5)]);

    mix.setSfxLevel(1);
    mix.setSfxLevel(0);
    expect(calls).toEqual([spatialVolumeFor(0.5), SPATIAL_SFX_UNITY, 0]);
    // Unity is the engine's own shipped volume, not full scale (decision 6).
    expect(SPATIAL_SFX_UNITY).toBe(SFX_LIMITS.volume);
  });

  it('ignores a level that is not a usable gain', () => {
    const seen: number[] = [];
    const mix = createMixLevels({
      setMusicGain: (g) => seen.push(g),
      setSfxGain: (g) => seen.push(g),
    });
    mix.setMusicLevel(Number.NaN);
    mix.setSfxLevel(Number.POSITIVE_INFINITY);
    expect(seen).toEqual([]);
    mix.setMusicLevel(-1);
    mix.setSfxLevel(4);
    expect(seen).toEqual([0, 1]);
  });
});

describe('the shipped defaults', () => {
  it('render sample-for-sample what a page with no settings renders', async () => {
    const untouched = await render();
    const defaults = await render({ levels: { music: 1, sfx: 1 } });
    expect(rms(untouched.master.left)).toBeGreaterThan(1e-3);
    expect(maxAbsDiff(untouched.master.left, defaults.master.left)).toBe(0);
    expect(maxAbsDiff(untouched.master.right, defaults.master.right)).toBe(0);
    expect(maxAbsDiff(untouched.room.left, defaults.room.left)).toBe(0);
  });
});
