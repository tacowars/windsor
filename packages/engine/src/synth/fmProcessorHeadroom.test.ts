/**
 * Every shipped preset is checked across seeded draws and its worst recorded
 * draw. A sampled sweep is evidence, not an exhaustive bound.
 *
 * Split out of fmProcessor.test.ts, which asserts DSP behaviour. This file
 * asserts a property of the patch set: it is the preset volumes that are on
 * trial here, and they move for reasons (a re-level, a new preset) that have
 * nothing to do with the engine. The file name keeps the `vitest run
 * fmProcessor` filter the ticket's determinism loop uses.
 *
 * Measurement behind every number: issue #78 and
 * docs/log/2026-09-02-bass-digital-clip-headroom.md.
 */
import { describe, expect, it } from 'vitest';

import { HEADROOM_RENDER, headroomEvents, peakAt } from '../__fixtures__/headroomSweep';
import { DEFAULT_SEED, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import type { Patch } from '../patch/patch';
import { SWEEP_COMMAND, loadPatchFile } from '../patch/patchLibrary';
import { PATCH_FILES } from '../patches/index';
import { PATCH_LIBRARY, PRESETS, PRESET_NAMES } from '../patch/presets';

const loaded = loadProcessor();

const held = (note: number, frames: number): ScheduledEvent[] => [
  { type: 'noteOn', id: 1, note, velocity: 0.9, frame: 0 },
  { type: 'noteOff', id: 1, frame: frames },
];

/**
 * Seeds every preset is rendered over. A seed pins the processor's whole
 * random surface -- operator start phase, the per-voice noise seed, the LFO
 * seed, pan jitter -- so sweeping seeds samples that surface where the phase
 * search in "bass-digital headroom" can only cover a patch with no noise
 * operator and no stochastic LFO.
 *
 * 64 is a sample, not a bound: what justifies each preset's volume is a
 * 16,384-seed sweep run offline and reported on the PR (#78) for the original
 * bank. #475 adds a 256-seed scoring-bank sweep plus full-envelope/register
 * and chord tests; neither finite sweep is an exhaustive bound.
 */
const SWEEP_SEEDS = 64;

/**
 * The seed that produced each patch's worst peak in its offline sweep,
 * rendered alongside the sample above. Since #561 it is each library file's
 * `headroom.worstSeed`, written by `tools/patch-editor/sweep-headroom.mjs`
 * and pinned to the patch by `headroom.contentHash`; `seedsSwept` says how
 * wide that sweep was (16,384 for the original bank, #78; 4,096 for `saw-arp`
 * and `drone-sqr`; 256 for the scoring bank, #475).
 *
 * Without these the sweep is only lucky. `weapon-zap` is the proof: restored
 * to its old 0.52 it peaks 0.983 over seeds 0..63 and passes, while seed 1261
 * peaks 1.081 and clips -- the exact defect this sweep exists to catch. A
 * sample cannot be trusted to rediscover a 1-in-900 draw, so the draws already
 * known to be worst are named and kept.
 *
 * A record is re-derived only by that sweep, and the PR says so: a seed edited
 * to make a test pass is worse than no seed at all.
 */
const WORST_KNOWN_SEED: Record<string, number> = Object.fromEntries(
  Object.values(PATCH_LIBRARY).map((entry) => [entry.id, entry.headroom.worstSeed]),
);

/** The quarter-second gate: a patch that has reached full level inside it must be audible. */
const GATE_SECONDS = HEADROOM_RENDER.noteOffFrame / loaded.sampleRate;
const attackSeconds = (patch: Patch): number =>
  Math.max(...patch.ops.map((op) => op.env.attackTime), patch.filter.env.attackTime);

describe('presets render clean audio', () => {
  it('has a recorded worst-case seed for every preset', () => {
    // A new preset joins PRESET_NAMES and must arrive with its own sweep, not
    // inherit the sample-only coverage of seeds 0..63.
    expect(Object.keys(WORST_KNOWN_SEED).sort()).toEqual([...PRESET_NAMES].sort());
  });

  it.each(PRESET_NAMES)('%s carries a current headroom record', (name) => {
    // The loader refused the file already if the record were missing or its
    // hash stale; this names the failure per patch, with the command that fixes it.
    const entry = PATCH_LIBRARY[name];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(() => loadPatchFile(name, PATCH_FILES[name])).not.toThrow();
    expect(entry.headroom.seedsSwept).toBeGreaterThanOrEqual(1);
    expect(entry.headroom.peak).toBeLessThanOrEqual(1);
    // The recorded seed still clears the line today; its recorded peak is the
    // sweep's reading, not re-asserted here, because the hash pins the record
    // to the patch and deliberately not to the engine.
    expect(peakAt(loaded, entry.patch, entry.headroom.worstSeed)).toBeLessThanOrEqual(1);
  });

  it('fails a missing or stale record with the sweep command', () => {
    const raw = PATCH_FILES['weapon-zap'] as Record<string, unknown>;
    const withoutRecord = { ...raw };
    delete withoutRecord['headroom'];
    expect(() => loadPatchFile('weapon-zap', withoutRecord)).toThrow(`${SWEEP_COMMAND} weapon-zap`);
    const patch = structuredClone(raw['patch']) as Patch;
    patch.volume *= 1.5;
    expect(() => loadPatchFile('weapon-zap', { ...raw, patch })).toThrow(
      `${SWEEP_COMMAND} weapon-zap`,
    );
  });

  it.each(PRESET_NAMES)('%s sounds, stays finite and does not clip on any seed', (name) => {
    const patch = PRESETS[name];
    expect(patch).toBeDefined();
    if (!patch) return;

    const seeds = [...Array.from({ length: SWEEP_SEEDS }, (_, i) => i), WORST_KNOWN_SEED[name]];

    let nonFinite = 0;
    let quietest = Infinity;
    let loudest = 0;
    let loudestSeed = -1;
    for (const seed of seeds) {
      if (seed === undefined) continue;
      const result = render(
        loaded,
        loaded.create(patch, HEADROOM_RENDER.voices, seed),
        HEADROOM_RENDER.blocks,
        headroomEvents(),
        { collectSamples: false },
      );
      nonFinite += result.nonFinite;
      quietest = Math.min(quietest, result.peak);
      if (result.peak > loudest) {
        loudest = result.peak;
        loudestSeed = seed;
      }
    }

    expect(nonFinite).toBe(0);
    // A quarter-second gate interrupts a slow swell before its attack, so the
    // audibility floor applies only to a patch that peaks inside the gate.
    // Full-envelope audibility and release: patchLibraryEnvelope.test.ts.
    expect(quietest).toBeGreaterThan(attackSeconds(patch) < GATE_SECONDS ? 0.002 : 0);
    expect(loudest, `${name} clips at seed ${loudestSeed}`).toBeLessThanOrEqual(1);
  });
});

describe('bass-digital headroom', () => {
  const bass = PRESETS['bass-digital'] as Patch;

  /**
   * The four free-running operator start phases are the whole of this preset's
   * exposure to randomness (it has no noise operator, no LFO and no
   * `panRandom`), and `phaseFree: false` lets a test name them. These are the
   * worst of ~900 multi-start hill climbs over that space at the trimmed
   * volume; peak there is 0.939, so the preset clears the clip line by ~6% for
   * *every* draw, not merely for the seed this file happens to use.
   * Measurement and the volume trim it justified:
   * docs/log/2026-09-02-bass-digital-clip-headroom.md.
   */
  const WORST_PHASES = [0.8106, 0.2533, 0.3475, 0.641];

  const atWorstPhases = (volumeScale = 1): Patch => {
    const patch = structuredClone(bass);
    patch.volume *= volumeScale;
    patch.ops.forEach((op, i) => {
      op.phaseFree = false;
      op.phase = WORST_PHASES[i] ?? 0;
    });
    return patch;
  };

  const peakOf = (patch: Patch, seed: number = DEFAULT_SEED): number =>
    render(loaded, loaded.create(patch, 16, seed), 400, held(60, 12000), {
      collectSamples: false,
    }).peak;

  it('clears the clip line at its worst start phases, with margin', () => {
    const peak = peakOf(atWorstPhases());
    expect(peak).toBeLessThanOrEqual(1);
    // The margin itself, so an erosion of it is a failure and not a near miss.
    expect(peak).toBeLessThan(0.96);
  });

  it('would clip on a volume bump -- the clip assertion is not vacuous', () => {
    // 10% is the whole headroom above. A change that quietly spent it (a hotter
    // operator, more filter drive, a volume nudge) fails the test above rather
    // than shipping a preset that clips on an unlucky draw.
    expect(peakOf(atWorstPhases(1.1))).toBeGreaterThan(1);
  });

  it('stays under the line across a seed sweep', () => {
    let worst = 0;
    for (let seed = 0; seed < 256; seed++) worst = Math.max(worst, peakOf(bass, seed));
    expect(worst).toBeLessThanOrEqual(1);
    expect(worst).toBeLessThan(0.9);
  });
});
