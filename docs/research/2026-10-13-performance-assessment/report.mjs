/* global console, process, URL */
/** Prints the README's tables from every results/*.json: medians over rounds, with min–max. */
import { readdirSync, readFileSync } from 'node:fs';

const folder = new URL('results/', import.meta.url);
const files = readdirSync(folder).filter((f) => f.endsWith('.json'));
const rows = [];
let environment = null;
const commits = new Set();
// One machine and browser per report: a results file from another is refused, not pooled.
const machine = (e) => [e.cpu, e.cores, e.arch, e.kernel, e.chromeVersion].join(' | ');
for (const f of files) {
  const data = JSON.parse(readFileSync(new URL(f, folder), 'utf8'));
  environment ??= data.environment;
  if (machine(data.environment) !== machine(environment)) {
    console.error(`${f} was taken on another machine or browser (${machine(data.environment)}); move it to a folder of its own`);
    process.exit(1);
  }
  commits.add(data.environment.commit);
  rows.push(...data.results.map((r) => ({ ...r, file: f })));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[(s.length >> 1) - 1] + s[s.length >> 1]) / 2;
};
const span = (xs, d = 0) =>
  xs.length > 1 ? `${median(xs).toFixed(d)} (${Math.min(...xs).toFixed(d)}–${Math.max(...xs).toFixed(d)})` : median(xs).toFixed(d);
const pct = (ms) => (ms / 10).toFixed(1);
const group = (list, by) => {
  const out = new Map();
  for (const r of list) {
    const k = by(r);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
};

console.log(`Environment: ${machine(environment)}, Node ${environment.node}`);
console.log(`Commits under test: ${[...commits].map((c) => c.slice(0, 7)).join(', ')} (${files.length} results files)\n`);

const offline = rows.filter((r) => r.kind === 'offline');
if (offline.length) {
  console.log('### Offline: the whole graph, ms of render time per second of audio (median over rounds, min–max)\n');
  console.log('| Case | Parts | Runs | ms per audio second | % of one core | Peak |');
  console.log('|---|---:|---:|---:|---:|---:|');
  for (const [name, list] of group(offline, (r) => r.name)) {
    const v = list.map((r) => r.msPerAudioSecond);
    console.log(`| ${name} | ${list[0].parts} | ${list.length} | ${span(v, 1)} | ${pct(median(v))} | ${list[0].peak.toFixed(3)} |`);
  }
  console.log();
}

const kinds = rows.filter((r) => r.kind === 'kind');
if (kinds.length) {
  // The baseline is the kinds round's own `none` case (the same 4-bar song with no insert);
  // the first round, before `none` existed, falls back to the 8-bar offline cases.
  const none = kinds.filter((r) => r.insert === 'none');
  const base = none.length ? none.filter((r) => !r.silent).map((r) => r.msPerAudioSecond) : offline.filter((r) => r.name === '16-none').map((r) => r.msPerAudioSecond);
  const silentBase = none.length ? none.filter((r) => r.silent).map((r) => r.msPerAudioSecond) : offline.filter((r) => r.name === '16-silent').map((r) => r.msPerAudioSecond);
  console.log('### Kinds: 16 parts with one insert of the kind each, ms per audio second; the per-insert column subtracts the 16-part song without inserts and divides by 16\n');
  console.log('| Kind | Playing, ms/s | Per insert, ms/s | Per insert, µs a quantum | Silent input, ms/s | Per silent insert, ms/s |');
  console.log('|---|---:|---:|---:|---:|---:|');
  const byKind = group(kinds, (r) => r.insert);
  const table = [];
  for (const [name, list] of byKind) {
    if (name === 'none') continue;
    const play = list.filter((r) => !r.silent).map((r) => r.msPerAudioSecond);
    const silent = list.filter((r) => r.silent).map((r) => r.msPerAudioSecond);
    const per = base.length ? (median(play) - median(base)) / 16 : NaN;
    const perSilent = silentBase.length && silent.length ? (median(silent) - median(silentBase)) / 16 : NaN;
    table.push({ name, play, silent, per, perSilent });
  }
  table.sort((a, b) => b.per - a.per);
  for (const t of table)
    console.log(`| ${t.name} | ${span(t.play, 0)} | ${t.per.toFixed(1)} | ${((t.per / 1000) * 1e6 / 375).toFixed(0)} | ${t.silent.length ? span(t.silent, 0) : '—'} | ${t.perSilent.toFixed(1)} |`);
  console.log();
}

const live = rows.filter((r) => r.kind === 'live');
if (live.length) {
  console.log('### Live: one render of the whole graph per quantum on the realtime audio thread, µs (median over rounds)\n');
  console.log('| Case | Runs | Rate | Budget µs | Mean | p50 | p95 | p99 | Max | Over budget / quanta | GC / s | Clock rate | Meter load % | Meter underruns |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const [name, list] of group(live, (r) => r.name)) {
    const ok = list.filter((r) => r.renders);
    if (!ok.length) { console.log(`| ${name} | ${list.length} | no renders traced |`); continue; }
    const m = (f) => span(ok.map(f), 0);
    const over = ok.map((r) => r.renders.overBudget).reduce((a, b) => a + b, 0);
    const quanta = ok.map((r) => r.renders.count).reduce((a, b) => a + b, 0);
    console.log(
      `| ${name} | ${ok.length} | ${ok[0].sampleRate} | ${ok[0].renders.budgetUs.toFixed(0)} | ${m((r) => r.renders.mean)} | ${m((r) => r.renders.p50)} | ${m((r) => r.renders.p95)} | ${m((r) => r.renders.p99)} | ${m((r) => r.renders.max)} | ${over} / ${quanta} | ${span(ok.map((r) => r.gc.perSecond), 1)} | ${span(ok.map((r) => r.clockRate), 3)} | ${span(ok.map((r) => r.meter.loadPct), 0)} | ${ok.map((r) => r.underrunsMeter).reduce((a, b) => a + b, 0)} |`,
    );
  }
  console.log();
}

const micro = rows.filter((r) => r.kind === 'micro');
if (micro.length) {
  console.log('### Micro: 16 of each on an offline context, ms per audio second (median over rounds)\n');
  console.log('| Case | ms per audio second | Per node, ms/s | Per node, µs a quantum |');
  console.log('|---|---:|---:|---:|');
  const keys = Object.keys(micro[0]).filter((k) => typeof micro[0][k] === 'number' && !['n', 'round', 'load1'].includes(k));
  const empty = median(micro.map((r) => r.empty));
  for (const k of keys) {
    const v = micro.map((r) => r[k]);
    const per = k === 'empty' ? 0 : (median(v) - empty) / 16;
    console.log(`| ${k} | ${span(v, 1)} | ${per.toFixed(2)} | ${((per / 1000) * 1e6 / 375).toFixed(2)} |`);
  }
  console.log();
}

const main = rows.filter((r) => r.kind === 'main');
if (main.length) {
  console.log('### Main thread: one knob tick on the 16-part, three-insert song, ms (median of 30 calls, median over rounds)\n');
  console.log('| Call | ms |');
  console.log('|---|---:|');
  for (const k of ['mergeMs', 'stripMergeMs', 'toJsonMs', 'applyPatchMs', 'applyStripMs'])
    console.log(`| ${k} | ${span(main.map((r) => r[k]), 2)} |`);
  console.log(`\nDocument: ${main[0].documentBytes} bytes of export text, ${main[0].parts} parts.\n`);
}
