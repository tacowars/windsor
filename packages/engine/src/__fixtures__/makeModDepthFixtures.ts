/**
 * Regenerates the two #543 reference fixtures — the state of `PRESETS` and of
 * the engine *before* modulation depth was rescaled.
 *
 *     npx tsx packages/engine/src/__fixtures__/makeModDepthFixtures.ts
 *     npx prettier --write packages/engine/src/__fixtures__/modDepth*.json
 *
 * Both outputs are a snapshot of main at the commit named in
 * `modDepthLevels.json`, taken before the migration landed, and
 * `modDepth.test.ts` measures the migration against them. Re-running this
 * after the change would overwrite the "before" with the "after" and make
 * that test assert nothing: only run it to move the reference point on
 * purpose, and say so in the ticket that does.
 *
 * Node-only, like everything in `__fixtures__/`: outside the engine's tsc
 * build so browser code cannot reach it.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ALGORITHMS } from '../audioConstants';
import { PRESETS } from '../patch/presets';
import { DEFAULT_SEED, loadProcessor, render } from './workletHarness';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Pre-change level of every operator of every factory preset, with its routing. */
function levelsFixture(): unknown {
  const presets: Record<string, { algorithm: number; levels: number[] }> = {};
  for (const name of Object.keys(PRESETS).sort()) {
    const patch = PRESETS[name];
    if (!patch) continue;
    presets[name] = { algorithm: patch.algorithm, levels: patch.ops.map((op) => op.level) };
  }
  return {
    note: 'Pre-#543 operator levels, rendered from main at db39e78b, where MOD_INDEX_SCALE was 8. Roles come from ALGORITHMS.',
    modIndexScale: 8,
    algorithms: ALGORITHMS.map((a) => ({ mods: a.mods, carriers: a.carriers })),
    presets,
  };
}

/** Three renders that must survive the migration unchanged to within -40 dB. */
const RENDERS = [
  { preset: 'lead-bell', note: 72, skipBlocks: 0 },
  // A slow pad: skip the first second so the window holds its sustain, not
  // the near-silence of its attack.
  { preset: 'score-polar-bloom', note: 60, skipBlocks: 376 },
  { preset: 'bass-digital', note: 36, skipBlocks: 0 },
] as const;
const VELOCITY = 0.9;
const BLOCK = 128;
const BLOCKS = 188; // 24064 frames, just over 0.5 s at 48 kHz
const INT16 = 32767;

function rendersFixture(): unknown {
  const loaded = loadProcessor();
  const clips: Record<string, { peak: number; pcm: string }> = {};
  for (const { preset, note, skipBlocks } of RENDERS) {
    const patch = PRESETS[preset];
    if (!patch) throw new Error(`no preset ${preset}`);
    const processor = loaded.create(patch, 16, DEFAULT_SEED);
    const events = [{ type: 'noteOn' as const, id: 1, note, velocity: VELOCITY, frame: 0 }];
    if (skipBlocks > 0) render(loaded, processor, skipBlocks, events);
    const result = render(loaded, processor, BLOCKS, skipBlocks > 0 ? [] : events);
    // Stored normalised to the window's peak, so int16 quantisation sits ~90 dB
    // below the signal even for a quiet pad; the test scales back by `peak`.
    const scale = result.peak > 0 ? INT16 / result.peak : 0;
    const pcm = Buffer.alloc(result.samples.length * 2);
    for (let i = 0; i < result.samples.length; i++) {
      pcm.writeInt16LE(Math.round((result.samples[i] ?? 0) * scale), i * 2);
    }
    clips[preset] = { peak: result.peak, pcm: pcm.toString('base64') };
  }
  return {
    note: 'Pre-#543 renders from main at db39e78b (MOD_INDEX_SCALE 8). Interleaved stereo int16 LE, base64, normalised to `peak`.',
    sampleRate: loaded.sampleRate,
    seed: DEFAULT_SEED,
    velocity: VELOCITY,
    frames: BLOCKS * BLOCK,
    notes: Object.fromEntries(RENDERS.map(({ preset, note }) => [preset, note])),
    skipBlocks: Object.fromEntries(RENDERS.map(({ preset, skipBlocks }) => [preset, skipBlocks])),
    blockFrames: BLOCK,
    clips,
  };
}

writeFileSync(join(HERE, 'modDepthLevels.json'), `${JSON.stringify(levelsFixture(), null, 2)}\n`);
writeFileSync(join(HERE, 'modDepthRenders.json'), `${JSON.stringify(rendersFixture(), null, 2)}\n`);
console.log('wrote modDepthLevels.json and modDepthRenders.json');
