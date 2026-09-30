/* global console */
// Prints the README's tables from ./summaries (written by analyse-trace.mjs).
// Run: node docs/research/2026-09-30-worklet-gc-in-chrome/tables.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'summaries', `${name}.json`), 'utf8'));
const QUANTA_PER_SECOND = 44_100 / 128;
const fmt = (x, places = 0) =>
  x.toLocaleString('en-GB', { minimumFractionDigits: places, maximumFractionDigits: places }).replaceAll(',', ' ');

const SCENARIOS = [
  'a-fm',
  'b-advanced-drive',
  'b-compressor',
  'b-delay',
  'b-phaser',
  'b-retro-reverb',
  'b-plate',
  'b-tape',
  'c-dense',
  'c-dense-2',
];

console.log('| Scenario | Minor GC | Major GC | GC / s | Longest pause, µs | GC time, ms/s | Bytes / quantum | MB per scavenge |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const name of SCENARIOS) {
  const s = load(name);
  const c = s.collections;
  const bytes = Object.values(s.bundles).reduce((sum, b) => sum + b.bytesPerQuantum, 0);
  const perGc = (bytes * QUANTA_PER_SECOND) / c.perSecond / 1e6;
  console.log(
    `| ${name} | ${c.minor} | ${c.major} | ${fmt(c.perSecond, 2)} | ${c.longestUs} | ${fmt(c.totalUs / 1000 / s.seconds, 2)} | ${fmt(bytes)} | ${fmt(perGc, 2)} |`,
  );
}

console.log('\n| Scenario | Quanta | Median span, µs | p99, µs | Max, µs | Over 2 902 µs | After a GC: quanta | Max with its GC, µs | Over |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const name of SCENARIOS) {
  const s = load(name);
  const [q, g] = [s.quantumSpans, s.quantumSpansAfterGc];
  console.log(
    `| ${name} | ${q.quanta} | ${q.medianUs} | ${q.p99Us} | ${q.maxUs} | ${q.overBudget} | ${g.quanta} | ${g.maxUs} | ${g.overBudget} |`,
  );
}

console.log('\n| Scenario | Bundle | Nodes | Bytes / call, median | mean | mean, second half | Bytes / quantum | Calls allocating | Excluded |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const name of [...SCENARIOS, 'a-fm-meter-on']) {
  const s = load(name);
  for (const [bundle, b] of Object.entries(s.bundles)) {
    console.log(
      `| ${name} | ${bundle.replace('-processor.js', '')} | ${b.nodes} | ${fmt(b.bytesPerCallMedian)} | ${fmt(b.bytesPerCallMean, 1)} | ${fmt(b.bytesPerCallMeanSecondHalf, 1)} | ${fmt(b.bytesPerQuantum, 1)} | ${b.callsAllocating} / ${b.callsMeasured} | ${b.callsExcluded} |`,
    );
  }
}
