/* global process, console */
// Reads one table (the last column of a row of `optimise.mjs` or
// `refine.mjs` output) through real renders at 48 kHz, against `main`, with
// `search.mjs`'s figures and margins: what the captures predicted, confirmed.
// node verify.mjs <new bundle> <main bundle> <tsv> <seed> <restart>
import { readFileSync } from 'node:fs';

import { compare, figures, passes } from './search.mjs';
import { loadTable } from './tapRig.mjs';

const [file, mainFile, tsv, seed, restart] = process.argv.slice(2);
const row = readFileSync(tsv, 'utf8')
  .split('\n')
  .map((l) => l.split('\t'))
  .find((r) => r[0] === seed && r[1] === restart);
const table = JSON.parse(row.at(-1));
const base = figures(loadTable(mainFile, 48000));
const c = compare(figures(loadTable(file, 48000, table)), base, table.trim);
console.log(JSON.stringify({ pass: passes(c), ...c }, (_, v) => (typeof v === 'number' ? Number(v.toFixed(4)) : v)));
