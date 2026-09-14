/**
 * Modulation depth after #543: the engine's scale halved, from 8 cycles of
 * phase at operator amplitude 1 (~50 rad) to 4 (~25 rad), and every factory
 * modulator's Level was multiplied by sqrt(2) so `level^2 x scale` — the depth
 * the patch was authored with — came out the same.
 *
 * The reference for both halves is `__fixtures__/modDepth*.json`, captured on
 * main at db39e78b before the change: the levels of all 114 presets with their
 * routing, and half a second of three of them rendered through the worklet.
 * `__fixtures__/makeModDepthFixtures.ts` is how they were made.
 */
import { describe, expect, it } from 'vitest';

import beforeLevels from './__fixtures__/modDepthLevels.json';
import beforeRenders from './__fixtures__/modDepthRenders.json';
import { DEFAULT_SEED, goertzel, loadProcessor, render } from './__fixtures__/workletHarness';
import { ALGORITHMS } from './audioConstants';
import { PRESETS } from './presets';
import { WAVE, makePatch } from './patch';

const loaded = loadProcessor();
const OLD_SCALE = beforeLevels.modIndexScale;
const NEW_SCALE = loaded.modIndexScale;

/** Depth is `level^2 x scale`; two patches match when their depths do. */
const depthOf = (level: number, scale: number): number => level * level * scale;
/** Index units. A modulator at Level 1 sits at 4, so this is ~0.1% of full depth. */
const DEPTH_TOLERANCE = 0.005;
/** The Level knob's top: a modulator that wanted more than this keeps 1. */
const FULL_LEVEL = 1;

interface Roles {
  modulates: boolean;
  carries: boolean;
}

/** Which of the four operators feed a phase and which reach the output. */
function rolesFor(algorithm: number): Roles[] {
  const alg = ALGORITHMS[algorithm];
  if (!alg) throw new Error(`no algorithm ${algorithm}`);
  const modulators = new Set<number>();
  for (const sources of alg.mods) for (const source of sources) modulators.add(source);
  return [0, 1, 2, 3].map((i) => ({
    modulates: modulators.has(i),
    carries: alg.carriers.includes(i),
  }));
}

describe('the engine scale', () => {
  it('is half what the factory bank was authored against', () => {
    // The whole migration is "levels x sqrt(2), scale / 2"; if the engine ever
    // moves again, the sqrt(2) in the preset files stops being the right number
    // and this fails before the depth comparison below can be misread.
    expect(NEW_SCALE).toBe(OLD_SCALE / 2);
  });
});

describe('the factory bank keeps the depth it was authored with', () => {
  const names = Object.keys(beforeLevels.presets);

  it('still holds exactly the presets the fixture recorded', () => {
    expect(Object.keys(PRESETS).sort()).toEqual([...names].sort());
  });

  it('still routes them the way the fixture recorded', () => {
    // Roles are read from ALGORITHMS below, so a routing change would silently
    // re-classify an operator and let a wrong level through.
    for (const name of names) {
      const record = beforeLevels.presets[name as keyof typeof beforeLevels.presets];
      expect(PRESETS[name]?.algorithm, name).toBe(record.algorithm);
    }
    expect(ALGORITHMS.map((alg) => ({ mods: alg.mods, carriers: alg.carriers }))).toEqual(
      beforeLevels.algorithms,
    );
  });

  it('rescales every modulator and leaves every carrier alone', () => {
    let rescaled = 0;
    let clamped = 0;
    for (const name of names) {
      const record = beforeLevels.presets[name as keyof typeof beforeLevels.presets];
      const patch = PRESETS[name];
      expect(patch, name).toBeDefined();
      if (!patch) continue;
      const roles = rolesFor(patch.algorithm);
      patch.ops.forEach((op, i) => {
        const where = `${name} op ${'ABCD'[i]}`;
        const old = record.levels[i] ?? 0;
        const role = roles[i] ?? { modulates: false, carries: false };
        if (!role.modulates || role.carries || old === 0) {
          expect(op.level, `${where} is not a modulator and must be untouched`).toBe(old);
          return;
        }
        if (depthOf(old, OLD_SCALE) > depthOf(FULL_LEVEL, NEW_SCALE)) {
          expect(op.level, `${where} asked for more depth than the knob holds`).toBe(FULL_LEVEL);
          clamped++;
          return;
        }
        expect(
          Math.abs(depthOf(op.level, NEW_SCALE) - depthOf(old, OLD_SCALE)),
          `${where}: ${old} -> ${op.level}`,
        ).toBeLessThanOrEqual(DEPTH_TOLERANCE);
        rescaled++;
      });
    }
    // The survey in #543: 275 active modulators, 5 of them past the new top.
    expect(rescaled + clamped).toBe(270 + 5);
    expect(clamped).toBe(5);
  });

  it('has no operator that is both a carrier and a modulator', () => {
    // Such an operator would need its volume and its depth moved in opposite
    // directions, which the migration does not do. Only Series + Tap's op B can
    // be one, and no factory preset uses it.
    for (const [name, patch] of Object.entries(PRESETS)) {
      const roles = rolesFor(patch.algorithm);
      patch.ops.forEach((op, i) => {
        const role = roles[i];
        if (!role) return;
        expect(role.modulates && role.carries && op.level > 0, `${name} op ${'ABCD'[i]}`).toBe(
          false,
        );
      });
    }
  });
});

/** A residual this far below the reference's peak is inaudible against it. */
const RESIDUAL_DB = -40;
const INT16 = 32767;

describe('the migrated presets render the sound they did before', () => {
  const clips = Object.entries(beforeRenders.clips) as [string, { peak: number; pcm: string }][];

  it.each(clips)('%s is unchanged to within -40 dB', (name, clip) => {
    const patch = PRESETS[name];
    expect(patch, name).toBeDefined();
    if (!patch) return;
    const note = beforeRenders.notes[name as keyof typeof beforeRenders.notes];
    const skip = beforeRenders.skipBlocks[name as keyof typeof beforeRenders.skipBlocks];
    const blocks = beforeRenders.frames / beforeRenders.blockFrames;

    const processor = loaded.create(patch, 16, DEFAULT_SEED);
    const events = [
      { type: 'noteOn' as const, id: 1, note, velocity: beforeRenders.velocity, frame: 0 },
    ];
    if (skip > 0) render(loaded, processor, skip, events);
    const now = render(loaded, processor, blocks, skip > 0 ? [] : events);

    // The fixture is stored normalised to its own peak, so int16 quantisation
    // (~ -90 dB) stays far below the residual this asserts.
    const pcm = Buffer.from(clip.pcm, 'base64');
    expect(pcm.length / 2).toBe(now.samples.length);
    let residual = 0;
    for (let i = 0; i < now.samples.length; i++) {
      const reference = (pcm.readInt16LE(i * 2) / INT16) * clip.peak;
      residual = Math.max(residual, Math.abs((now.samples[i] ?? 0) - reference));
    }
    const db = 20 * Math.log10(residual / clip.peak);
    expect(db, `${name} residual ${residual.toExponential(2)} of peak ${clip.peak}`).toBeLessThan(
      RESIDUAL_DB,
    );
  });
});

const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES) + 1;
const A4 = 69;
const SETTLE_S = 0.1;
const WINDOW_S = 1;
/** A harmonic this far below the fundamental counts as absent. */
const ABSENT = 0.02;
/**
 * The modulated carrier is the same sine at the same amplitude, so its peak
 * cannot grow; the slack only covers which sample instant catches the crest.
 */
const PEAK_TOLERANCE = 1.02;

/** Two-operator Series: a sine carrier, a sine modulator at ratio 1. */
function seriesRun(level: number): ReturnType<typeof render> {
  const env = { attackTime: 0.001, decayTime: 1, sustainLevel: 1, releaseTime: 0.3 };
  const processor = loaded.create(
    makePatch({
      algorithm: 0,
      ops: [
        { wave: WAVE.SINE, level: 1, env },
        { wave: WAVE.SINE, ratio: 1, level, env },
      ],
    }),
    4,
  );
  render(loaded, processor, blocksFor(SETTLE_S), [
    { type: 'noteOn', id: 1, note: A4, velocity: 1, frame: 0 },
  ]);
  return render(loaded, processor, blocksFor(WINDOW_S));
}

describe('the Level knob at the top of its travel', () => {
  const f0 = 440;
  const silent = seriesRun(0);
  const full = seriesRun(1);

  it('is a pure sine with the modulator at 0', () => {
    const fundamental = goertzel(silent.samples, f0, SR);
    expect(goertzel(silent.samples, f0 * 2, SR) / fundamental).toBeLessThan(ABSENT);
    expect(goertzel(silent.samples, f0 * 3, SR) / fundamental).toBeLessThan(ABSENT);
  });

  it('stays finite and no louder at 1', () => {
    expect(full.nonFinite).toBe(0);
    expect(full.peak).toBeLessThanOrEqual(silent.peak * PEAK_TOLERANCE);
    // ...and it is doing something: full depth is a dense spectrum, not a sine.
    expect(goertzel(full.samples, f0 * 2, SR) / goertzel(full.samples, f0, SR)).toBeGreaterThan(
      ABSENT,
    );
  });
});
