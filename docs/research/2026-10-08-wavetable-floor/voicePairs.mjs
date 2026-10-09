/* global console, process */
// `voiceCost.mts` for two checkouts, interleaved: each round runs one process
// per checkout per scenario, in alternating order; the result is the median
// of the rounds' after / before ratios.
// Usage: node voicePairs.mjs <before root> <after root> <rounds> <scenario>[,<scenario>…]
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [before, after, roundsArg, scenarios] = process.argv.slice(2);
const BENCH = join(dirname(fileURLToPath(import.meta.url)), 'voiceCost.mts');
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
function measure(root, scenario) {
  const out = execFileSync('npx', ['-y', 'tsx@4.20.3', BENCH, root, '5'], {
    env: { ...process.env, SCENARIOS: scenario },
    encoding: 'utf8',
  });
  return Number(/median ([\d.]+) ms/.exec(out)[1]);
}
for (const scenario of scenarios.split(',')) {
  const ratios = [];
  const pairs = [];
  for (let r = 0; r < Number(roundsArg); r++) {
    const first = r % 2 === 0;
    const a = first ? measure(before, scenario) : 0;
    const b = measure(after, scenario);
    const a2 = first ? a : measure(before, scenario);
    ratios.push(b / a2);
    pairs.push(`${a2.toFixed(0)}→${b.toFixed(0)}`);
  }
  console.log(`${scenario}: median after/before ${median(ratios).toFixed(3)} over ${ratios.length} rounds [${ratios.map((x) => x.toFixed(2)).join(', ')}] (ms ${pairs.join(', ')})`);
}
