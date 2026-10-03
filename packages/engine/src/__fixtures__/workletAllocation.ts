/**
 * Runs `workletAllocationProbe.ts` for a test (windsor#198, windsor#214): a
 * Node of its own with `--expose-gc`, a 64 MB young generation (nothing the
 * run allocates is collected before it is counted), the heap swept on the
 * main thread (`SETTLED_HEAP`) and `--trace-generalization`, whose result it
 * reads from a JSON file the child writes into a temporary directory. Stdout
 * carries the trace alone: on Linux CI the trace ran into a result line
 * written there. A heap reading inside Vitest is not repeatable, since the
 * runner shares the heap.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { runV8Child } from './v8Probe';
import type { ProbeConfig, ProbeResult } from './workletAllocationProbe';

const PROBE = fileURLToPath(new URL('./workletAllocationProbe.ts', import.meta.url));

/** A shipped bundle's path, from its file name (`eq-processor.js`). */
export function workletBundle(file: string): string {
  return fileURLToPath(new URL(`../worklet/generated/${file}`, import.meta.url));
}

/** A fixture module's path, for `ProbeConfig.scenario`. */
export function probeScenario(file: string): string {
  return fileURLToPath(new URL(`./${file}`, import.meta.url));
}

/**
 * V8 compiles on the main thread: a function is optimised at the call that
 * makes it hot, not when a background thread gets to it, so the tier each
 * function has reached when the measured run starts depends on the calls the
 * warm-up made and never on the machine's load. With concurrent compilation
 * a warm-up of a cheap render lasts tens of milliseconds, and on a busy
 * runner a function can still be waiting for its optimised code when the
 * heap is read (windsor#256).
 */
export const SYNCHRONOUS_TIERING = ['--no-concurrent-recompilation'] as const;

/**
 * Every probe sweeps on the main thread (windsor#269). The probe reads the
 * heap straight after two forced collections, and by default V8 sweeps what
 * they freed on background threads. On a loaded machine that sweeping can
 * still be running when the first reading is taken, and the bytes it settles
 * land in the first measured tenth: from 3 to 8 KB over its usual 1.2 KB in
 * the FM part's kernel run, or a large negative, the other nine tenths
 * byte-identical, which pushed a clean run past its bound on CI. With the
 * sweeping on the main thread no background sweeper is still at work when
 * the first window is read, and a clean run reads the same bytes in every
 * window as before (the measurements are in windsor#269's PR).
 */
const SETTLED_HEAP = ['--no-concurrent-sweeping'] as const;

export interface ProbeRun extends ProbeResult {
  /** Each generalisation the bundle caused that changed a field's representation. */
  changes: string[];
}

/**
 * Runs the probe. `flags` are V8 flags the child takes beside the fixed ones,
 * such as `SYNCHRONOUS_TIERING`.
 */
export function runAllocationProbe(config: ProbeConfig, flags: readonly string[] = []): ProbeRun {
  const { result, changes } = runV8Child<ProbeResult>({
    script: { path: PROBE },
    args: (_dir, out) => [JSON.stringify(config), out],
    flags: [...SETTLED_HEAP, ...flags],
    traceScript: basename(config.bundle),
    prefix: 'worklet-allocation-',
  });
  return { ...result, changes };
}

/**
 * The growth over the measured run with each tenth clamped at 0 before the
 * tenths are summed (windsor#277). A tenth can read a drop in the heap that
 * no collection the `GCProfiler` counted explains: with a leak in the Phaser,
 * one tenth read -605 120 bytes and the other nine about 54 KB each, and the
 * plain total, -115 592, passed (windsor#275). Clamped, a drop cannot cancel
 * the growth in another tenth. A clean run's tenths are byte-identical and
 * positive, so for it this is the plain total.
 */
export function allocatedBytes(windows: readonly number[]): number {
  return windows.reduce((sum, bytes) => sum + Math.max(0, bytes), 0);
}

/**
 * Asserts the run allocated nothing: no collection ran while the heap was
 * read, and the growth over its tenths (`allocatedBytes`) is under
 * `toleranceBytes`. The failure names each tenth's reading.
 */
export function expectAllocationFree(
  run: Pick<ProbeRun, 'gcs' | 'windows'>,
  toleranceBytes: number,
): void {
  expect(run.gcs, 'no collection ran while the heap was read').toBe(0);
  expect(allocatedBytes(run.windows), `by tenths: ${run.windows.join(' ')}`).toBeLessThan(
    toleranceBytes,
  );
}
