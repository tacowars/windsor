/**
 * Worklet rules 2 and 7 for the Parametric EQ (windsor#198), measured on V8
 * rather than read off the source: once its paths have run, toggling type,
 * slope and on allocates nothing, and no field of the bundle ever changes its
 * representation.
 *
 * Method. A heap reading inside Vitest is not repeatable (the runner shares
 * the heap), so the test spawns a Node of its own that runs the shipped bundle
 * (`__fixtures__/eqAllocationProbe.ts`) with `--expose-gc`, a 64 MB young
 * generation (nothing it allocates is collected before it is counted) and
 * `--trace-generalization`. The child warms every path the audio thread has
 * for 48 000 quanta (glides, toggles, the output and enable fades, silence, a
 * load report), forces two collections, then toggles type, slope and on in
 * turn on all eight bands every 8 quanta (a fade out and back in each time)
 * for 40 000 quanta, reading `used_heap_size` in ten windows. It also counts
 * the collections in that time, which must be none, or the reading means
 * nothing. The load report is off while it reads: it calls Date.now() twice a
 * quantum, and V8 returns each as a new heap number (32 bytes a quantum).
 *
 * Tolerance: 16 KiB over the 40 000 quanta. They hold 40 000 band switches, so
 * one boxed double per switch would read about 480 KB. The run reads 6 752
 * bytes, every run alike: each reading's own result object, about 600 bytes.
 *
 * Representation. V8 types a field by its first value. A double field first
 * written as a small integer is a Smi field, and its first fraction
 * generalises it, which deprecates the object's map and deoptimises the code
 * that reads it; until that code is optimised again it boxes every double.
 * The EQ's doubles were first written as 0 or 1, and `fade` took its first
 * fraction at the first type, slope or on change: 42 generalisations in this
 * run before the fix, none after. The trace names each one, the field and the
 * bundle line that caused it; none may change a representation (a field's
 * first write, from `v` for none, is its birth, not a change).
 *
 * What this does not cover: the first changes after a long steady run still
 * run code V8 has not optimised yet, which boxes (see the research README).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PROBE_RESULT, PROBE_SCRIPT_NAME } from '../__fixtures__/eqAllocationProbe';
import type { ProbeConfig } from '../__fixtures__/eqAllocationProbe';
import { EQ_BAND_COUNT, EQ_BAND_TYPES, EQ_SLOPES } from './eqConstants';
import { EQ_BAND_PARAMS, eqParamName, eqParameterValues } from './eqParameters';
import type { EqSpec } from './eqSpec';

const PROBE = fileURLToPath(new URL('../__fixtures__/eqAllocationProbe.ts', import.meta.url));
const BUNDLE = fileURLToPath(new URL('../worklet/generated/eq-processor.js', import.meta.url));
const TOLERANCE_BYTES = 16 * 1024;

/** Every band audible (a bell or shelf at a gain), each at its own frequency. */
const SPEC: EqSpec = {
  kind: 'eq',
  enabled: true,
  scale: 1,
  output: 0,
  bands: Array.from({ length: EQ_BAND_COUNT }, (_, b) => ({
    on: true,
    type: EQ_BAND_TYPES[b % EQ_BAND_TYPES.length]!,
    slope: 24 as const,
    freq: 137.3 * (b + 1),
    gain: 6.5,
    q: 1.3,
  })),
};

interface ProbeRun {
  bytes: number;
  /** The growth in each tenth of the measured run. */
  windows: number[];
  gcs: number;
  /** Each generalisation the bundle caused that changed a field's representation. */
  changes: string[];
}

function probe(): ProbeRun {
  const config: ProbeConfig = {
    bundle: BUNDLE,
    rate: 48000,
    params: eqParameterValues(SPEC),
    names: Object.fromEntries(
      EQ_BAND_PARAMS.map((field) => [
        field,
        Array.from({ length: EQ_BAND_COUNT }, (_, b) => eqParamName(b, field)),
      ]),
    ) as ProbeConfig['names'],
    typeCount: EQ_BAND_TYPES.length,
    slopeCount: EQ_SLOPES.length,
    warmup: 48000,
    measure: 40000,
    period: 8,
  };
  const child = spawnSync(
    process.execPath,
    [
      '--expose-gc',
      '--min-semi-space-size=64',
      '--max-semi-space-size=64',
      '--trace-generalization',
      '--no-warnings',
      PROBE,
      JSON.stringify(config),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  expect(child.status, child.stderr).toBe(0);
  const lines = child.stdout.split('\n');
  const result = lines.find((line) => line.startsWith(PROBE_RESULT));
  expect(result, 'the probe reports').toBeDefined();
  // `[generalizing]fade:s{Any;mutable}->d{Any;mutable} (…) [~step+39 at eq-processor.js:559]`
  const change = /^\[generalizing\][^:]*:([a-z])\{[^}]*\}->([a-z])\{/;
  const changes = lines.filter((line) => {
    const m = change.exec(line);
    return !!m && line.includes(` at ${PROBE_SCRIPT_NAME}:`) && m[1] !== 'v' && m[1] !== m[2];
  });
  return { ...(JSON.parse(result!.slice(PROBE_RESULT.length)) as ProbeRun), changes };
}

describe('the audio thread on V8', () => {
  it('toggles type, slope and on for 40 000 quanta without allocating or changing a field representation', () => {
    const run = probe();
    expect(run.changes).toEqual([]);
    expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
    expect(run.bytes, `by tenths: ${run.windows.join(' ')}`).toBeLessThan(TOLERANCE_BYTES);
  }, 120_000);
});
