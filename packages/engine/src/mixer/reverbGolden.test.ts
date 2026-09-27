/**
 * The plate's render, hashed, scenario by scenario (#671).
 *
 * The reverb's move from one hand-written file into `worklet/reverb/` must
 * change no output bit, and so must any later refactor of it. This is the
 * gate, in the shape of `fmProcessorGolden.test.ts`: every scenario the reverb
 * tests exercise (an impulse and a noise burst from the harness's PRNG, the
 * decay and SIZE extremes, HOLD, the runaway ceiling, a SIZE glide, a wet
 * turned up late, the filters and modulation off their defaults) plus the
 * sleep path (#547) -- a tail that falls asleep, and one that is woken -- is
 * rendered in three paths and hashed against `__fixtures__/reverbGolden.json`:
 * the default, `sleep: false` and `settledSkip: false`. The settled-SIZE skip
 * is exact by construction, so its path must also agree with the default to
 * the bit on this machine, which is the check that survives a platform whose
 * `Math` differs from the one that wrote the table (Node 24's V8, like the FM
 * table -- `worklet/CLAUDE.md` rule 4).
 *
 * A failure means the render changed. When that is intended (a DSP ticket),
 * refresh the table with the command in `REFRESH` and say so in the PR; a
 * refactor never refreshes it.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import golden from '../__fixtures__/reverbGolden.json';
import type {
  Automate,
  Feed,
  ReverbCreateOptions,
  ReverbProcessorLike,
} from '../__fixtures__/reverbHarness';
import {
  impulse,
  internals,
  loadReverb,
  noiseBurst,
  renderReverb,
} from '../__fixtures__/reverbHarness';

const REFRESH =
  'A204_REFRESH_REVERB_GOLDEN=1 npx vitest run packages/engine/src/mixer/reverbGolden.test.ts';
const refreshing = process.env['A204_REFRESH_REVERB_GOLDEN'] === '1';
const TABLE = fileURLToPath(new URL('../__fixtures__/reverbGolden.json', import.meta.url));

const loaded = loadReverb();
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * loaded.sampleRate) / BLOCK);
/**
 * A cap, not a deadline: well past the time a decay-0.3 tail takes to fall
 * under the floor and sleep. Each sleep row asserts that it slept.
 */
const SLEEP_RENDER_S = 7;
/** The plate the sleep rows use, named here so tuning a default cannot starve them of sleep. */
const QUICK_TAIL = { decay: 0.3 };

/** The paths, by the name the table keys them under. */
const PATHS: Record<string, ReverbCreateOptions> = {
  default: {},
  noSleep: { sleep: false },
  noSettledSkip: { settledSkip: false },
};
const PATH_NAMES = Object.keys(PATHS);

interface Scenario {
  seconds: number;
  feed: Feed;
  params?: Record<string, number>;
  automate?: Automate;
  /** The default path must pass through this state at least once, or the row pins nothing of it. */
  visits?: 'asleep' | 'settled and stepping';
  /** Called after each block, so a feed can react to the plate's state. */
  watch?: (block: number, processor: ReverbProcessorLike) => void;
}

/**
 * A click every `every` blocks, the same sign on both channels: the plate sums
 * its input to mono, so opposite signs would cancel and leave the tank silent.
 */
const clicks = (every: number): Feed => {
  return (block, left, right) => {
    if (block % every !== 0) return;
    left[0] = 1;
    right[0] = 1;
  };
};

const SCENARIOS: Record<string, () => Scenario> = {
  impulse: () => ({ seconds: 3, feed: impulse }),
  'decay-short': () => ({ seconds: 2, feed: impulse, params: { decay: 0.3 } }),
  'decay-long': () => ({ seconds: 3, feed: impulse, params: { decay: 0.9 } }),
  'size-box': () => ({ seconds: 2, feed: impulse, params: { size: 0.1 } }),
  'size-cathedral': () => ({ seconds: 3, feed: impulse, params: { size: 4 } }),
  'size-and-decay': () => ({ seconds: 3, feed: impulse, params: { size: 1.4, decay: 0.78 } }),
  'dry-only': () => ({ seconds: 0.5, feed: impulse, params: { dry: 1, wet: 0 } }),
  'max-diffusion': () => ({
    seconds: 3,
    feed: noiseBurst(0.5),
    params: {
      decay: 1,
      diffusionTank1: 0.8,
      diffusionTank2: 0.8,
      tankLowCut: 10,
      tankHighCut: 20000,
    },
  }),
  hold: () => ({ seconds: 3, feed: noiseBurst(0.5), params: { hold: 1 } }),
  'hold-released': () => ({
    seconds: 3,
    feed: noiseBurst(0.5),
    automate: (block, values) => {
      values.hold![0] = block < blockAt(1.5) ? 1 : 0;
    },
  }),
  'filters-and-modulation': () => ({
    seconds: 2,
    feed: noiseBurst(0.3),
    params: {
      preDelay: 0.25,
      inputLowCut: 200,
      inputHighCut: 3000,
      diffusionIn1: 0.5,
      diffusionIn2: 0.4,
      tankLowCut: 120,
      tankHighCut: 2500,
      modRate: 3,
      modDepth: 2,
      dry: 0.5,
    },
  }),
  'size-glide': () => ({
    seconds: 2,
    feed: clicks(blockAt(0.3)),
    automate: (block, values) => {
      values.size![0] = block < blockAt(0.5) ? 1 : block < blockAt(1) ? 2.5 : 0.6;
    },
    visits: 'settled and stepping',
  }),
  'wet-late': () => ({
    seconds: 3,
    feed: impulse,
    automate: (block, values) => {
      values.wet![0] = block < blockAt(1.8) ? 0 : 1;
    },
  }),
  sleep: () => ({
    seconds: SLEEP_RENDER_S,
    feed: impulse,
    params: QUICK_TAIL,
    visits: 'asleep',
  }),
  'sleep-and-wake': () => {
    // A second impulse a quarter second after the plate is first seen asleep:
    // the wake path, wherever sleep lands.
    let wakeAt = -1;
    return {
      seconds: SLEEP_RENDER_S,
      feed: (block, left, right) => {
        if (block === 0 || block === wakeAt) impulse(0, left, right);
      },
      params: { ...QUICK_TAIL, dry: 0.25 },
      visits: 'asleep',
      watch: (block, processor) => {
        if (wakeAt < 0 && internals(processor)._asleep) wakeAt = block + blockAt(0.25);
      },
    };
  },
};
const SCENARIO_NAMES = Object.keys(SCENARIOS);

function hashRender(name: string, path: string): string {
  const scenario = SCENARIOS[name]!();
  let asleep = false;
  let settled = false;
  let stepping = false;
  const afterBlock = (block: number, processor: ReverbProcessorLike): void => {
    const plate = internals(processor);
    scenario.watch?.(block, processor);
    if (plate._asleep) asleep = true;
    if (plate._stepping) stepping = true;
    else settled = true;
  };
  const result = renderReverb(loaded, scenario.seconds, scenario.feed, scenario.params, {
    ...(scenario.automate ? { automate: scenario.automate } : {}),
    create: PATHS[path]!,
    collectSamples: true,
    afterBlock,
  });
  expect(result.nonFinite).toBe(0);
  expect(result.peak).toBeGreaterThan(0);
  if (path === 'default' && scenario.visits === 'asleep') {
    expect(asleep, `${name} never slept, so it pins nothing of the sleep path`).toBe(true);
  }
  if (path === 'default' && scenario.visits === 'settled and stepping') {
    expect(settled && stepping, `${name} must glide and settle`).toBe(true);
  }
  const { samples } = result;
  return createHash('sha256')
    .update(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength))
    .digest('hex');
}

const table: Record<string, Record<string, string>> = golden.hashes;
const fresh: Record<string, Record<string, string>> = {};

describe('the plate renders the same bits as the golden table', () => {
  it('has a row for every scenario and no scenario that is gone', () => {
    expect(Object.keys(table).sort(), `scenarios and the table differ — ${REFRESH}`).toEqual(
      [...SCENARIO_NAMES].sort(),
    );
  });

  it.each(SCENARIO_NAMES)('%s', (name) => {
    const hashes = Object.fromEntries(PATH_NAMES.map((p) => [p, hashRender(name, p)]));
    fresh[name] = hashes;
    expect(hashes['noSettledSkip'], `${name}: the settled-SIZE skip changed a sample`).toBe(
      hashes['default'],
    );
    if (refreshing) return;
    for (const path of PATH_NAMES) {
      expect(
        hashes[path],
        `${name} (${path}) renders differently from __fixtures__/reverbGolden.json. ` +
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
  const next = { ...golden, sampleRate: loaded.sampleRate, hashes: sorted };
  writeFileSync(TABLE, `${JSON.stringify(next, null, 2)}\n`);
});
