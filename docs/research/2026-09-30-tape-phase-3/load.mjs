/** Bundle tracked TypeScript sources, never generated worklets. Run from repo root. */
/* global process */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
export async function loadSource(contents, revision) {
  const root = process.cwd();
  const result = await build({
    stdin: { contents, resolveDir: root, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'esnext',
    plugins: revision
      ? [
          {
            name: 'pinned-source',
            setup(b) {
              b.onLoad({ filter: /\.ts$/ }, ({ path }) => ({
                contents: execFileSync(
                  'git',
                  ['show', `${revision}:${path.slice(root.length + 1)}`],
                  { encoding: 'utf8' },
                ),
                loader: 'ts',
              }));
            },
          },
        ]
      : [],
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}
export const researchEntry = `
export * from './docs/research/2026-09-30-tape-phase-3/hysteresis.ts';
export * from './docs/research/2026-09-30-tape-phase-3/resampler.ts';
export * from './docs/research/2026-09-30-tape-phase-3/experimentConstants.ts';`;
