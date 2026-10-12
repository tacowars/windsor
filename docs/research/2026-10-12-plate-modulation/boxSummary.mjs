/* global process, console */
// Summarises a box.mjs table: non-finite samples, the T30 cells outside ±10 %
// and the HOLD cells whose tank or wet level left ±1 dB.
// node boxSummary.mjs <box.tsv>...
import { readFileSync } from 'node:fs';

const rows = process.argv
  .slice(2)
  .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n').slice(1))
  .filter((line) => !line.startsWith('variant'))
  .map((line) => line.split('\t'));
const key = (r) => `${r[1]} Hz, ${r[2]} Hz ${r[3]} ms, Size ${r[4]}, Build ${r[6]}`;
const tails = rows.filter((r) => r[7] === '0');
const held = rows.filter((r) => r[7] === '1');
console.log(`${rows.length} rows; non-finite in ${rows.filter((r) => r[10] !== '0').length}`);
for (const decay of ['0.2', '10', '60']) {
  const cells = tails.filter((r) => r[5] === decay);
  const errors = cells.map((r) => Number(r[8]));
  const out = cells.filter((r) => Math.abs(Number(r[8])) >= 10);
  console.log(
    `Decay ${decay}: T30 error ${Math.min(...errors).toFixed(1)} to ${Math.max(...errors).toFixed(1)} %, ${out.length} of ${cells.length} outside ±10 %`,
  );
  // Decay 0.2 s is shorter than a trip round a large tank, and its T30 is the
  // input stage's own ring: its range is enough.
  if (decay !== '0.2') for (const r of out) console.log(`  ${key(r)}: ${r[8]} %`);
}
const tank = held.map((r) => Number(r[13]));
console.log(`HOLD: tank energy at 33 s ${Math.min(...tank).toFixed(2)} to ${Math.max(...tank).toFixed(2)} dB`);
for (const r of held.filter((r) => Math.abs(Number(r[13])) > 1 || Number(r[12]) > 1 || Number(r[11]) < -1)) {
  console.log(`  ${key(r)}: tank ${r[13]} dB, wet ${r[11]}..${r[12]} dB, peak ${r[9]}`);
}
