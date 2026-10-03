/**
 * Runs a probe over an esbuild bundle in a Node of its own, for the heap-delta
 * allocation tests (worklet rule 2; windsor#503). The entry is bundled as an
 * IIFE under `globalName` and written as `bundleName` beside the probe in a
 * temporary directory. The child runs with `--expose-gc`, a 64 MB young
 * generation, so nothing is collected before it is counted, and
 * `--trace-generalization`. It is called as
 * `node probe.cjs <bundle> <out> ...args` and writes its JSON to `<out>`.
 *
 * Node-only, by design: excluded from the engine's tsc build.
 */
// reads-by-path: none (bundles the entry its caller passes, and reads the temp files it writes)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import { representationChanges } from './generalizationTrace';

const FLAGS = [
  '--expose-gc',
  '--min-semi-space-size=64',
  '--max-semi-space-size=64',
  '--trace-generalization',
  '--no-warnings',
];
const MAX_BUFFER = 64 * 1024 * 1024;

export interface V8ProbeOptions {
  /** Absolute path of the module to bundle. */
  entry: string;
  /** The IIFE's global, which the probe reads the module's exports from. */
  globalName: string;
  /** The bundle's file name: the script name the generalisation trace is filtered by. */
  bundleName: string;
  /** The probe's CommonJS source. */
  probe: string;
  /** The child's arguments after the bundle and the output paths. */
  args: readonly string[];
}

export interface V8ProbeResult<T> {
  /** The JSON the probe wrote. */
  result: T;
  /** Every field representation change in the bundle (`generalizationTrace.ts`). */
  changes: string[];
}

/** Bundle the entry, run the probe over it, and read back what it wrote. */
export function v8Probe<T>(options: V8ProbeOptions): V8ProbeResult<T> {
  const { entry, globalName, bundleName, probe, args } = options;
  const bundled = buildSync({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    globalName,
    platform: 'neutral',
    target: 'esnext',
    minify: false,
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
  });
  const dir = mkdtempSync(join(tmpdir(), `${bundleName.replace(/\.js$/, '')}-`));
  try {
    const files = { bundle: join(dir, bundleName), probe: join(dir, 'probe.cjs') };
    writeFileSync(files.bundle, bundled.outputFiles[0]!.text);
    writeFileSync(files.probe, probe);
    const out = join(dir, 'result.json');
    const child = spawnSync(process.execPath, [...FLAGS, files.probe, files.bundle, out, ...args], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    if (child.status !== 0) {
      throw new Error(`the probe exited with ${String(child.status)}:\n${child.stderr}`);
    }
    return {
      result: JSON.parse(readFileSync(out, 'utf8')) as T,
      changes: representationChanges(child.stdout, bundleName),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
