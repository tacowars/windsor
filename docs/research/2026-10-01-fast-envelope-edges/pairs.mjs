/* global console, process */
// windsor#301: `bench.mjs` for two checkouts, interleaved, so a load the
// machine carries falls on both alike (the windsor#300 method,
// `2026-10-01-voice-drive/pairs.mjs`). Each round runs one process per
// checkout per scenario, in alternating order, and the round's ratio is
// after / before; the result is the median ratio over the rounds.
// Usage: node pairs.mjs <before root> <after root> <rounds> <scenario>[,<scenario>…]
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [before, after, roundsArg, scenarios] = process.argv.slice(2);
const BENCH = join(dirname(fileURLToPath(import.meta.url)), 'bench.mjs');
const RUNS = '9';

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function measure(root, scenario) {
  const out = execFileSync(process.execPath, [BENCH, root, scenario, RUNS], { encoding: 'utf8' });
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
    `${scenario}: before ${median(b).toFixed(1)} ms, after ${median(a).toFixed(1)} ms, ` +
      `ratio ${median(ratios).toFixed(3)} [${ratios.map((x) => x.toFixed(2)).join(',')}]`,
  );
}
