/* global process, console */
// The sweep's lead, by Size and Build (windsor#763): from `sweep<rate>.tsv`,
// for a click on L alone and on R alone, how many cells lead by under 3 dB
// in the 0–50 ms window, and the least lead, at each Size and Build. A cell
// whose fed side holds under 1/1000 (−30 dB) of its first second's energy in
// that window has heard nothing there yet (the input chain's own delay at
// diffusion 0, Build's spread and the tank's first taps at Size 4 put the
// first arrival past 50 ms): it is counted apart, as "empty".
// node summary.mjs <sweep tsv>
import { readFileSync } from 'node:fs';

const [file] = process.argv.slice(2);
const [head, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
const names = head.split('\t');
const rows = lines.map((line) => {
  const cells = line.split('\t');
  return Object.fromEntries(names.map((n, i) => [n, i === 0 ? cells[i] : Number(cells[i])]));
});

/** One Size and Build's cells for one input: how many lead under 3 dB, how many are empty, the least lead. */
function leads(input, build, size) {
  const mine = rows.filter((r) => r.input === input && r.build === build && r.size === size);
  let under = 0;
  let empty = 0;
  let least = Infinity;
  for (const r of mine) {
    const [fed, other, second] = input === 'left' ? [r.l50, r.r50, r.l1] : [r.r50, r.l50, r.r1];
    if (fed < second * 1e-3) {
      empty++;
      continue;
    }
    const lead = 10 * Math.log10(fed / other);
    if (lead < 3) under++;
    least = Math.min(least, lead);
  }
  return { under, heard: mine.length - empty, empty, least };
}

console.log(`| Input | Build | Size | under 3 dB | empty | least lead, dB |`);
console.log('|---|---|---|---|---|---|');
for (const input of ['left', 'right']) {
  for (const build of [0, 0.5, 1]) {
    for (const size of [0.05, 0.25, 1, 4]) {
      const { under, heard, empty, least } = leads(input, build, size);
      const shown = Number.isFinite(least) ? (least > 99 ? '> 99' : least.toFixed(1)) : '–';
      console.log(`| ${input} | ${build} | ${size} | ${under} of ${heard} | ${empty} | ${shown} |`);
    }
  }
}
