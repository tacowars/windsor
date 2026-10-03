/**
 * Runs a probe over an esbuild bundle in a Node of its own, for the heap-delta
 * allocation tests (worklet rule 2; windsor#503). `runV8Child`, the run
 * itself, is shared with `workletAllocation.ts`. The entry is bundled as an
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
  return runV8Child<T>({
    script: { source: probe },
    files: { [bundleName]: bundled.outputFiles[0]!.text },
    args: (dir, out) => [join(dir, bundleName), out, ...args],
    traceScript: bundleName,
    prefix: `${bundleName.replace(/\.js$/, '')}-`,
  });
}

export interface V8ChildOptions {
  /** The child's script: a path, or CommonJS source written as `probe.cjs` in the temporary directory. */
  script: { path: string } | { source: string };
  /** Files written into the temporary directory before the child starts, by name. */
  files?: Readonly<Record<string, string>>;
  /** The child's arguments after the script, given the temporary directory and the file it writes its JSON to. */
  args(dir: string, out: string): readonly string[];
  /** V8 flags the child takes beside the fixed ones. */
  flags?: readonly string[];
  /** The script name the generalisation trace is filtered by. */
  traceScript: string;
  /** The temporary directory's name prefix. */
  prefix: string;
}

/**
 * Run a script in a Node of its own with the fixed flags and a temporary
 * directory, and read back the JSON it wrote and the representation changes
 * its trace shows in `traceScript`. Throws with the child's stderr if it
 * exits non-zero.
 */
export function runV8Child<T>(options: V8ChildOptions): V8ProbeResult<T> {
  const { script, files = {}, args, flags = [], traceScript, prefix } = options;
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    const scriptPath = 'path' in script ? script.path : join(dir, 'probe.cjs');
    if ('source' in script) writeFileSync(scriptPath, script.source);
    const out = join(dir, 'result.json');
    const child = spawnSync(process.execPath, [...FLAGS, ...flags, scriptPath, ...args(dir, out)], {
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    if (child.status !== 0) {
      throw new Error(`the probe exited with ${String(child.status)}:\n${child.stderr}`);
    }
    return {
      result: JSON.parse(readFileSync(out, 'utf8')) as T,
      changes: representationChanges(child.stdout, traceScript),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
