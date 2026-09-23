/**
 * Every factory preset's render, hashed, in all three voice paths (#643).
 *
 * The FM worklet's refactor (#638) moves code between files and must change
 * no output bit. This is the gate: one chord per preset, rendered through the
 * default path, the generic loop (`specialise: false`, #548) and the
 * non-dormant path (`dormancy: false`, #547), each hashed and compared with
 * the table in `__fixtures__/fmGolden.json`. The generic loop must also agree
 * with the default path to the bit on this machine (#548's contract; the
 * non-dormant path is held to -120 dB by `fmProcessorDormancy.test.ts`, so
 * it is pinned by its own row only), which is the check that survives a
 * platform whose `Math` differs from the one that wrote the table.
 *
 * A failure means the render changed. When that is intended (a DSP ticket),
 * refresh the table with the command in `REFRESH` and say so in the PR; a
 * refactor never refreshes it.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import golden from '../__fixtures__/fmGolden.json';
import { DEFAULT_SEED, loadProcessor, render } from '../__fixtures__/workletHarness';
import type { CreateOptions, ScheduledEvent } from '../__fixtures__/workletHarness';
import { PRESET_NAMES, PRESETS } from '../patch/presets';

const REFRESH =
  'A204_REFRESH_FM_GOLDEN=1 npx vitest run packages/client/src/audio/synth/fmProcessorGolden.test.ts';
const refreshing = process.env['A204_REFRESH_FM_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/fmGolden.json', import.meta.url));

const loaded = loadProcessor();
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number =>
  Math.ceil((seconds * loaded.sampleRate) / BLOCK_FRAMES);

/** The paths, by the name the table keys them under. */
const PATHS: Record<string, CreateOptions> = {
  default: {},
  generic: { specialise: false },
  noDormancy: { dormancy: false },
};
const PATH_NAMES = Object.keys(PATHS);

const HOLD_S = 0.4;
const TAIL_S = 0.6;
/** A chord off the block and control boundaries, one note slid, one released early. */
const CHORD: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 40, velocity: 0.9, frame: 0 },
  { type: 'noteOn', id: 2, note: 59, velocity: 0.55, mod: 0.4, frame: 1 },
  { type: 'noteOn', id: 3, note: 76, velocity: 0.35, frame: 2 * BLOCK_FRAMES + 33 },
  { type: 'noteOn', id: 4, note: 64, velocity: 0.7, slide: true, frame: 5 * BLOCK_FRAMES + 9 },
  { type: 'noteOff', id: 2, frame: blocksFor(HOLD_S / 2) * BLOCK_FRAMES + 7 },
];
const RELEASE: ScheduledEvent[] = [
  { type: 'noteOff', id: 1, frame: 1 },
  { type: 'noteOff', id: 3, frame: 65 },
  { type: 'noteOff', id: 4, frame: 66 },
];

function hashRender(name: string, options: CreateOptions): string {
  const patch = PRESETS[name];
  if (!patch) throw new Error(`${name} is not a factory preset`);
  const processor = loaded.create(patch, 16, DEFAULT_SEED, options);
  const held = render(loaded, processor, blocksFor(HOLD_S), CHORD);
  const tail = render(loaded, processor, blocksFor(TAIL_S), RELEASE);
  expect(held.nonFinite + tail.nonFinite).toBe(0);
  expect(held.samples.some((s) => s !== 0)).toBe(true);
  const hash = createHash('sha256');
  for (const { samples } of [held, tail]) {
    hash.update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength));
  }
  return hash.digest('hex');
}

const table: Record<string, Record<string, string>> = golden.hashes;
const fresh: Record<string, Record<string, string>> = {};

describe('the factory bank renders the same bits as the golden table', () => {
  it('has a row for every preset and no preset that is gone', () => {
    expect(Object.keys(table).sort(), `presets and the table differ — ${REFRESH}`).toEqual(
      [...PRESET_NAMES].sort(),
    );
  });

  it.each(PRESET_NAMES)('%s', (name) => {
    const hashes = Object.fromEntries(PATH_NAMES.map((p) => [p, hashRender(name, PATHS[p]!)]));
    fresh[name] = hashes;
    expect(hashes['generic'], `${name}: the generic loop disagrees with the kernel`).toBe(
      hashes['default'],
    );
    if (refreshing) return;
    for (const path of PATH_NAMES) {
      expect(
        hashes[path],
        `${name} (${path}) renders differently from __fixtures__/fmGolden.json. ` +
          `If the change is intended, refresh the table with \`${REFRESH}\` and say so in the PR.`,
      ).toBe(table[name]?.[path]);
    }
  });
});

afterAll(() => {
  if (!refreshing) return;
  const sorted = Object.fromEntries(
    Object.keys(fresh)
      .sort()
      .map((k) => [k, fresh[k]]),
  );
  const next = { ...golden, seed: DEFAULT_SEED, sampleRate: loaded.sampleRate, hashes: sorted };
  writeFileSync(TABLE, `${JSON.stringify(next, null, 2)}\n`);
});
