/* global console, process */
// windsor#300: `bench.mts` for two checkouts, interleaved, so a load the
// machine carries falls on both alike. Each round runs one process per
// checkout per scenario, in alternating order, and the round's ratio is
// after / before; the result is the median ratio over the rounds.
// Usage: node pairs.mjs <before root> <after root> <rounds> <scenario>[,<scenario>…] [after-only scenario,…]
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [before, after, roundsArg, scenarios, afterOnly = ''] = process.argv.slice(2);
const BENCH = join(dirname(fileURLToPath(import.meta.url)), 'bench.mts');
const RUNS = '5';

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function measure(root, scenario) {
  const out = execFileSync('npx', ['tsx', BENCH, root, 'x', RUNS], {
    env: { ...process.env, SCENARIOS: scenario },
    encoding: 'utf8',
  });
  return Number(/median ([\d.]+) ms/.exec(out)[1]);
}

const rounds = Number(roundsArg);
for (const scenario of scenarios.split(',').filter(Boolean)) {
  const ratios = [];
  const b = [];
  const a = [];
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? ['b', 'a'] : ['a', 'b'];
    const got = {};
    for (const which of order) got[which] = measure(which === 'b' ? before : after, scenario);
    b.push(got.b);
    a.push(got.a);
    ratios.push(got.a / got.b);
  }
  console.log(
    `${scenario}: before ${median(b).toFixed(0)} ms, after ${median(a).toFixed(0)} ms, ` +
      `ratio ${median(ratios).toFixed(3)} [${ratios.map((x) => x.toFixed(2)).join(',')}]`,
  );
}
for (const scenario of afterOnly.split(',').filter(Boolean)) {
  const times = Array.from({ length: rounds }, () => measure(after, scenario));
  console.log(`${scenario} (after only): ${median(times).toFixed(0)} ms [${times.map((t) => t.toFixed(0)).join(',')}]`);
}
