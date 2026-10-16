/* global process, console, URL */
/** Prints the research note's tables from `results/` (windsor#837):
 *   node docs/research/2026-10-16-worklet-warm-up/report.mjs
 * The cold-start files (`coldStart.mjs`, labels `before-*` and `after-*`) give the
 * underrun table and the steady render (the second ▶'s quanta); the probe files
 * (`coldProbe.mjs`, `*-probe-*`) give the per-processor table. A file from another
 * machine or browser than the first one read is refused.
 */
import { readdirSync, readFileSync } from 'node:fs';

const folder = new URL('results/', import.meta.url);
const files = readdirSync(folder).filter((name) => name.endsWith('.json'));
const read = (name) => JSON.parse(readFileSync(new URL(name, folder), 'utf8'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const span = (values, digits = 0) =>
  `${median(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)}–${Math.max(...values).toFixed(digits)})`;
const any = (values) => `${values.filter((v) => v > 0).length}/${values.length}`;

function coldStart() {
  const runs = files
    .filter((name) => !name.includes('-probe-') && !name.includes('-dump-'))
    .map(read);
  if (runs.length === 0) return;
  const machine = `${runs[0].environment.cpu} / ${runs[0].environment.chromeVersion}`;
  for (const r of runs) {
    const here = `${r.environment.cpu} / ${r.environment.chromeVersion}`;
    if (here !== machine) throw Error(`results from ${here}, not ${machine}`);
  }
  console.log(`Cold start, ${machine}\n`);
  console.log(
    '| Song | Rate | Bundles | Runs | Build: device | Build: DSP | Build: device ms | First ▶: device | First ▶: DSP | First ▶: runs with a device underrun | First ▶: worst quantum, ms | Second ▶: device | Second ▶: DSP |',
  );
  console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  const rows = new Map();
  for (const file of runs) {
    for (const r of file.results) {
      const key = [r.name, r.started.sampleRate, file.environment.label.split('-')[0]].join('|');
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(r);
    }
  }
  for (const [key, list] of [...rows].sort()) {
    const [song, rate, bundles] = key.split('|');
    const pick = (fn) => list.map(fn);
    console.log(
      `| ${song} | ${rate} | ${bundles} | ${list.length} | ${span(pick((r) => r.build.device))} | ${span(pick((r) => r.build.dsp))} | ${span(pick((r) => r.build.deviceMs))} | ${span(pick((r) => r.first.device))} | ${span(pick((r) => r.first.dsp))} | ${any(pick((r) => r.first.device))} | ${list[0].trace ? span(pick((r) => r.trace.first.worstUs / 1000), 1) : '–'} | ${span(pick((r) => r.second.device))} | ${span(pick((r) => r.second.dsp))} |`,
    );
  }
  console.log('\nSteady render: the second ▶, mean wall time a quantum of the whole graph (µs)\n');
  console.log('| Song | Rate | Before | After | Change |');
  console.log('|---|---|---:|---:|---:|');
  const steady = new Map();
  for (const [key, list] of rows) {
    if (!list[0].trace) continue;
    const [song, rate, bundles] = key.split('|');
    const means = list.map((r) => (r.trace.second.renderMs * 1000) / r.trace.second.quanta);
    const at = `${song}|${rate}`;
    if (!steady.has(at)) steady.set(at, {});
    steady.get(at)[bundles] = means;
  }
  for (const [at, { before, after }] of [...steady].sort()) {
    if (!before || !after) continue;
    const [song, rate] = at.split('|');
    const change = ((median(after) - median(before)) / median(before)) * 100;
    console.log(`| ${song} | ${rate} | ${span(before)} | ${span(after)} | ${change.toFixed(1)} % |`);
  }
}

function probes() {
  const all = files.filter((name) => name.includes('-probe-')).map(read);
  if (all.length === 0) return;
  console.log(`\nPer processor, Node ${all[0].environment.node} (V8 ${all[0].environment.v8}), ${all[0].environment.cpu}\n`);
  for (const rate of [...new Set(all.map((p) => p.environment.rate))].sort()) {
    const group = all.filter((p) => p.environment.rate === rate && !p.environment.twin);
    const before = group.filter((p) => p.environment.bundles === 'other');
    const after = group.filter((p) => p.environment.bundles === 'worktree');
    if (before.length === 0 || after.length === 0) continue;
    console.log(`\n${rate} Hz, ${before.length} runs before and ${after.length} after; medians\n`);
    console.log(
      '| Processor | Construct, ms (before → after) | First quantum of signal, µs | Excess over steady, first 10 quanta, ms | First 100, ms | Steady, µs a quantum |',
    );
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const name of before[0].rows.map((r) => r.name)) {
      const of = (set, field) => median(set.map((p) => p.rows.find((r) => r.name === name)[field]));
      const pair = (field, digits) => `${of(before, field).toFixed(digits)} → ${of(after, field).toFixed(digits)}`;
      console.log(
        `| ${name} | ${pair('constructMs', 2)} | ${pair('firstUs', 0)} | ${pair('excessMs10', 2)} | ${pair('excessMs100', 2)} | ${pair('steadyUs', 1)} |`,
      );
    }
  }
  const twins = all.filter((p) => p.environment.twin);
  if (twins.length === 0) return;
  console.log('\nAn ideal warm-up (a throwaway processor of the class first), main’s bundles; first quantum µs / ms the warm-up took\n');
  const lengths = [...new Set(twins.map((p) => p.environment.twin))].sort((a, b) => a - b);
  console.log(`| Processor | ${lengths.map((n) => `${n} quanta`).join(' | ')} |`);
  console.log(`|---|${lengths.map(() => '---:').join('|')}|`);
  for (const name of twins[0].rows.map((r) => r.name)) {
    const cells = lengths.map((n) => {
      const set = twins.filter((p) => p.environment.twin === n);
      const rows = set.map((p) => p.rows.find((r) => r.name === name));
      return `${median(rows.map((r) => r.firstUs)).toFixed(0)} / ${median(rows.map((r) => r.twinMs)).toFixed(1)}`;
    });
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
}

/** The `--dump` runs: each slow quantum of a press's first 400 ms, and V8's compiling on the audio thread there. */
function dumps() {
  const RENDER = 'RealtimeAudioDestinationHandler::Render';
  for (const name of files.filter((n) => n.includes('-dump-'))) {
    const file = read(name);
    for (const r of file.results) {
      for (const press of ['first', 'second']) {
        const events = r.trace[press];
        const slow = events
          .filter((e) => e.name === RENDER && e.dur > (128 / r.started.sampleRate) * 1e6)
          .map((e) => `${(e.dur / 1000).toFixed(1)} ms at ${e.ms.toFixed(0)} ms`);
        const compile = events.filter((e) => e.name === 'V8.CompileCode');
        const ms = (list) => list.reduce((s, e) => s + e.dur / 1000, 0).toFixed(1);
        const optimise = events.filter((e) => /Finalize|InstallOptimized/.test(e.name));
        console.log(
          `${file.environment.label} run ${r.run}, ${press} ▶: over budget ${slow.join(', ') || 'none'}; lazy compiles ${compile.length} (${ms(compile)} ms); optimised-code installs ${ms(optimise)} ms`,
        );
      }
    }
  }
}

coldStart();
dumps();
probes();
process.exit(0);
