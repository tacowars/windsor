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

export interface ProbeRun extends ProbeResult {
  /** Each generalisation the bundle caused that changed a field's representation. */
  changes: string[];
}

/**
 * Run the probe on `config`. `v8Flags` go to the child's Node before the
 * probe's own (`--no-turbo-inlining`, to measure a path as if V8 declined to
 * inline its calls, as it may in a larger render than the test's).
 */
export function runAllocationProbe(config: ProbeConfig, v8Flags: string[] = []): ProbeRun {
  const dir = mkdtempSync(join(tmpdir(), 'worklet-allocation-'));
  try {
    const resultFile = join(dir, 'result.json');
    const child = spawnSync(
      process.execPath,
      [
        ...v8Flags,
        '--expose-gc',
        '--min-semi-space-size=64',
        '--max-semi-space-size=64',
        '--trace-generalization',
        '--no-warnings',
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
