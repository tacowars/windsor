/* global process */
/**
 * The ladder alone (windsor#573): ns per sample of one `Ladder` from the
 * bundle, on each solver candidate, a 110 Hz saw at peak 1 (carrier units)
 * through a 1 kHz cutoff at k 16.5, a ladder's process() called once a
 * sample as the render loops call it; on a bundle with the output mix
 * (windsor#577), the mix at the Reso knob's top, its gain 2.6 (`--mix`);
 * on a bundle with the makeup (windsor#587), the makeup at k 16.5's,
 * √17.5 (`--makeup`). Research only: the whole voice's reading is
 * `bench.mjs`.
 *
 *   node ladderBench.mjs <repo> [--seconds 20] [--mix 2.6] [--makeup 4.1833]
 */
import { performance } from 'node:perf_hooks';

import { CANDIDATES, SR, candidate, loadBundle } from './bundle.mjs';

const args = process.argv.slice(2);
const root = args[0] ?? '.';
const seconds = args.includes('--seconds') ? Number(args[args.indexOf('--seconds') + 1]) : 20;
const mixGain = args.includes('--mix') ? Number(args[args.indexOf('--mix') + 1]) : 2.6;
const makeup = args.includes('--makeup')
  ? Number(args[args.indexOf('--makeup') + 1])
  : Math.sqrt(1 + 16.5);
const { Ladder } = loadBundle(root);

for (const name of Object.keys(CANDIDATES)) {
  const ladder = candidate(new Ladder(), name, { cutoffHz: 1000, k: 16.5, mixGain, makeup });
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
