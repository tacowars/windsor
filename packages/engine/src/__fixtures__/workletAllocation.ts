/**
 * Runs `workletAllocationProbe.ts` for a test (windsor#198, windsor#214): a
 * Node of its own with `--expose-gc`, a 64 MB young generation (nothing the
 * run allocates is collected before it is counted) and
 * `--trace-generalization`, whose result it reads from a JSON file the child
 * writes into a temporary directory. Stdout carries the trace alone: on Linux
 * CI the trace ran into a result line written there. A heap reading inside
 * Vitest is not repeatable, since the runner shares the heap.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { representationChanges } from './generalizationTrace';
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

export interface ProbeRun extends ProbeResult {
  /** Each generalisation the bundle caused that changed a field's representation. */
  changes: string[];
}

/**
 * Runs the probe. `flags` are V8 flags the child takes beside the fixed ones,
 * such as `SYNCHRONOUS_TIERING`.
 */
export function runAllocationProbe(config: ProbeConfig, flags: readonly string[] = []): ProbeRun {
  const dir = mkdtempSync(join(tmpdir(), 'worklet-allocation-'));
  try {
    const resultFile = join(dir, 'result.json');
    const child = spawnSync(
      process.execPath,
      [
        '--expose-gc',
        '--min-semi-space-size=64',
        '--max-semi-space-size=64',
        '--trace-generalization',
        '--no-warnings',
        ...flags,
        PROBE,
        JSON.stringify(config),
        resultFile,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(readFileSync(resultFile, 'utf8')) as ProbeResult;
    return { ...result, changes: representationChanges(child.stdout, basename(config.bundle)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
