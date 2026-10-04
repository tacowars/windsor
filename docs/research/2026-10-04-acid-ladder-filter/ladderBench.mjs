/* global process */
/**
 * The ladder alone (windsor#573): ns per sample of one `Ladder` from the
 * bundle, on each solver candidate, a 110 Hz saw at peak 1 (carrier units)
 * through a 1 kHz cutoff at k 16.5, a ladder's process() called once a
 * sample as the render loops call it. Research only: the whole voice's
 * reading is `bench.mjs`.
 *
 *   node ladderBench.mjs <repo> [--seconds 20]
 */
import { performance } from 'node:perf_hooks';

import { CANDIDATES, SR, candidate, loadBundle } from './bundle.mjs';

const args = process.argv.slice(2);
const root = args[0] ?? '.';
const seconds = Number(args[args.indexOf('--seconds') + 1] || 20);
const { Ladder } = loadBundle(root);

for (const name of Object.keys(CANDIDATES)) {
  const ladder = candidate(new Ladder(), name, { cutoffHz: 1000, k: 16.5 });
  const n = seconds * SR;
  const input = new Float64Array(SR);
  for (let i = 0; i < SR; i++) input[i] = 2 * ((i * 110) / SR - Math.floor((i * 110) / SR)) - 1;
  const run = () => {
    const started = performance.now();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      ladder.point = input[i % SR];
      ladder.process();
      sum += ladder.point;
    }
    return [((performance.now() - started) * 1e6) / n, sum];
  };
  run();
  const readings = [run()[0], run()[0], run()[0]];
  process.stdout.write(
    `${name}: ${readings.map((r) => r.toFixed(1)).join(', ')} ns a sample (node ${process.version})\n`,
  );
}
