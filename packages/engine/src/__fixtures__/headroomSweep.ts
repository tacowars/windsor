/**
 * Node-only real-DSP clip sweep shared by `fmProcessorHeadroom.test.ts` and
 * the offline record writer (`tools/patch-editor/sweep-headroom.mjs`, which
 * bundles this file with esbuild). One definition of the render every headroom
 * number in the library was measured with, so a `worstSeed` recorded by the
 * tool is the seed the test renders.
 */
import type { Patch } from '../patch';
import type { LoadedProcessor, ScheduledEvent } from './workletHarness';
import { loadProcessor, render } from './workletHarness';

export { loadPatchFile, patchContentHash } from '../patchLibrary';

/** The headroom render: a quarter-second note at velocity 0.9, 400 blocks, 16 voices. */
export const HEADROOM_RENDER = {
  voices: 16,
  blocks: 400,
  note: 60,
  velocity: 0.9,
  noteOffFrame: 12000,
} as const;

export const headroomEvents = (): ScheduledEvent[] => [
  {
    type: 'noteOn',
    id: 1,
    note: HEADROOM_RENDER.note,
    velocity: HEADROOM_RENDER.velocity,
    frame: 0,
  },
  { type: 'noteOff', id: 1, frame: HEADROOM_RENDER.noteOffFrame },
];

export interface HeadroomPeak {
  worstSeed: number;
  peak: number;
}

/** Peak sample of one seeded render; throws on a non-finite sample. */
export function peakAt(dsp: LoadedProcessor, patch: Patch, seed: number): number {
  const result = render(
    dsp,
    dsp.create(patch, HEADROOM_RENDER.voices, seed),
    HEADROOM_RENDER.blocks,
    headroomEvents(),
    { collectSamples: false },
  );
  if (result.nonFinite) throw new Error(`${patch.name}: non-finite output at seed ${seed}`);
  return result.peak;
}

/** The seed with the highest peak over `seeds`, with that peak. */
export function sweepHeadroom(
  patch: Patch,
  seeds: Iterable<number>,
  dsp: LoadedProcessor = loadProcessor(),
): HeadroomPeak {
  let worst: HeadroomPeak = { worstSeed: -1, peak: -Infinity };
  for (const seed of seeds) {
    const peak = peakAt(dsp, patch, seed);
    if (peak > worst.peak) worst = { worstSeed: seed, peak };
  }
  if (worst.worstSeed < 0) throw new Error('sweep needs at least one seed');
  return worst;
}

/** `0 … count - 1`. */
export const seedRange = (count: number): number[] => Array.from({ length: count }, (_, i) => i);
