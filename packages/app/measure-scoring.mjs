/* global console, process */
/** Run from the repo root: node tools/patch-editor/measure-scoring.mjs [seed-count]. */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const seeds = Number(process.argv[2] ?? 256);
if (!Number.isSafeInteger(seeds) || seeds < 1)
  throw new Error('seed-count must be a positive integer');
const entry = resolve('packages/client/src/audio/__fixtures__/scoringSweep.ts');
const output = resolve('node_modules/.cache-475-scoring-sweep.mjs');
await build({
  entryPoints: [entry],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  define: { 'import.meta.url': JSON.stringify(pathToFileURL(entry).href) },
});
const { sweep } = await import(pathToFileURL(output).href);
const results = sweep(seeds);
const destination = 'packages/client/src/audio/__fixtures__/scoringHeadroom.json';
writeFileSync(
  destination,
  JSON.stringify(
    {
      seeds,
      sampleRate: 48000,
      blocks: 400,
      note: 60,
      velocity: 0.9,
      noteOffFrame: 12000,
      results,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Wrote ${Object.keys(results).length} sampled peaks to ${destination}`);
