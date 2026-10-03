/* global console */
/** windsor#533: the README's tables, from every results/*.json the bench wrote (a `-quick`
 * harness check is left out). A run is one audio page, so every N's delta is paired with
 * the N = 0 segments of the same page; a main-thread delta is paired with the same
 * round's N = 0 page. Each cell is the mean over runs, with the runs' minimum and maximum.
 *   node docs/research/2026-10-03-always-on-part-meters/report.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { BENCH } from './benchConstants.mjs';

const folder = new URL('./results/', import.meta.url);
const US_PER_S = 1e6;
const PERCENT = 100;
const files = readdirSync(folder).filter((f) => f.endsWith('.json') && !f.includes('quick'));
const results = files.map((f) => JSON.parse(readFileSync(new URL(f, folder), 'utf8')));
const passes = results.flatMap((r, invocation) => r.passes.map((p) => ({ ...p, invocation })));
const failed = passes.filter((p) => p.error);
const ok = passes.filter((p) => !p.error);

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const fmt = (x, digits = 1) => x.toFixed(digits);
const spread = (xs, digits = 1) =>
  `${fmt(mean(xs), digits)} (${fmt(Math.min(...xs), digits)}–${fmt(Math.max(...xs), digits)})`;
const budgetUs = (p) => (BENCH.quantumFrames / p.setup.sampleRate) * US_PER_S;
const pct = (us, p) => (us / budgetUs(p)) * PERCENT;
const tally = (xs) =>
  [...new Set(xs)].map((x) => `${x} × ${xs.filter((y) => y === x).length}`).join(', ');
const row = (cells) => `| ${cells.join(' | ')} |`;

function audioTable(c) {
  const lines = [
    row([
      'Variant',
      'N',
      'Mean, µs',
      'p95, µs',
      'Mean, % of budget',
      'Δ mean vs N = 0, µs',
      'Δ, % of budget',
    ]),
    row(['---', '---:', '---:', '---:', '---:', '---:', '---:']),
  ];
  for (const variant of BENCH.variants) {
    const runs = ok.filter((p) => p.kind === 'audio' && p.case === c && p.variant === variant);
    for (const n of BENCH.counts) {
      const at = runs.map((p) => p.byN[n]);
      const delta = runs.map((p) => p.byN[n].wallUs.mean - p.byN[0].wallUs.mean);
      lines.push(
        row([
          variant,
          n,
          spread(at.map((s) => s.wallUs.mean)),
          spread(
            at.map((s) => s.wallUs.p95),
            0,
          ),
          spread(
            at.map((s, i) => pct(s.wallUs.mean, runs[i])),
            2,
          ),
          n === 0 ? '—' : spread(delta),
          n === 0
            ? '—'
            : spread(
                delta.map((d, i) => pct(d, runs[i])),
                2,
              ),
        ]),
      );
    }
  }
  return [
    `Runs per variant: ${ok.filter((p) => p.kind === 'audio' && p.case === c && p.variant === 'separate').length}.`,
    '',
    ...lines,
  ];
}

function gcTable() {
  const lines = [
    row([
      'Case',
      'Variant',
      'N',
      'CPU mean, µs',
      'Scavenges / s',
      'GC, ms / s',
      'Longest pause, µs',
      'Renders holding a GC',
      'Quanta / s',
    ]),
    row(['---', '---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']),
  ];
  for (const c of BENCH.cases)
    for (const variant of BENCH.variants) {
      const runs = ok.filter((p) => p.kind === 'audio' && p.case === c && p.variant === variant);
      for (const n of BENCH.counts) {
        const at = runs.map((p) => p.byN[n]);
        lines.push(
          row([
            c,
            variant,
            n,
            spread(at.map((s) => s.cpuUs.mean)),
            spread(at.map((s) => s.gc.scavengesPerSecond)),
            spread(
              at.map((s) => s.gc.msPerSecond),
              2,
            ),
            fmt(Math.max(...at.map((s) => s.gc.maxPauseUs)), 0),
            at.reduce((sum, s) => sum + s.gc.rendersHoldingGc, 0),
            `${fmt(Math.min(...at.map((s) => s.quantaPerSecond)))}–${fmt(Math.max(...at.map((s) => s.quantaPerSecond)))}`,
          ]),
        );
      }
    }
  return lines;
}

function messageRates() {
  const lines = [
    row(['Case', 'Variant', 'N', 'Reports / s, main thread']),
    row(['---', '---', '---:', '---:']),
  ];
  for (const c of BENCH.cases)
    for (const variant of BENCH.variants)
      for (const n of BENCH.counts.filter((k) => k > 0)) {
        const rates = ok
          .filter((p) => p.kind === 'audio' && p.case === c && p.variant === variant)
          .flatMap((p) => p.segments.filter((s) => s.n === n).map((s) => s.messagesPerSecond));
        lines.push(row([c, variant, n, spread(rates)]));
      }
  return lines;
}

function mainTable() {
  const lines = [
    row([
      'Case',
      'Variant',
      'N',
      'Handler calls / s',
      'Handler, ms / s',
      'Handler tasks, ms / s',
      'Busy, ms / s',
      'Δ busy vs N = 0, ms / s',
    ]),
    row(['---', '---', '---:', '---:', '---:', '---:', '---:', '---:']),
  ];
  const mains = ok.filter((p) => p.kind === 'main');
  const baseline = (p) =>
    mains.find(
      (b) => b.n === 0 && b.case === p.case && b.round === p.round && b.invocation === p.invocation,
    );
  for (const c of BENCH.cases)
    for (const variant of ['none', ...BENCH.variants]) {
      const runs = mains.filter((p) => p.case === c && p.variant === variant);
      const deltas = runs
        .filter(baseline)
        .map((p) => p.busyMsPerSecond - baseline(p).busyMsPerSecond);
      lines.push(
        row([
          c,
          variant,
          runs[0]?.n ?? '',
          spread(runs.map((p) => p.handlersPerSecond)),
          spread(
            runs.map((p) => p.handlerMsPerSecond),
            2,
          ),
          spread(
            runs.map((p) => p.handlerTaskMsPerSecond),
            2,
          ),
          spread(
            runs.map((p) => p.busyMsPerSecond),
            2,
          ),
          variant === 'none' ? '—' : spread(deltas, 2),
        ]),
      );
    }
  return [
    `Runs per row: ${mains.filter((p) => p.case === 'song' && p.variant === 'none').length}.`,
    '',
    ...lines,
  ];
}

function offlineTable() {
  const lines = [
    row(['Variant', 'N', 'ms / quantum', 'Δ vs N = 0, µs / quantum']),
    row(['---', '---:', '---:', '---:']),
  ];
  const off = ok.filter((p) => p.kind === 'offline');
  const baseline = (p) =>
    off.find(
      (b) =>
        b.n === 0 && b.round === p.round && b.repeat === p.repeat && b.invocation === p.invocation,
    );
  for (const variant of ['none', ...BENCH.variants])
    for (const n of variant === 'none' ? [0] : BENCH.counts.filter((k) => k > 0)) {
      const runs = off.filter((p) => p.variant === variant && p.n === n);
      const deltas = runs.map((p) => (p.msPerQuantum - baseline(p).msPerQuantum) * 1000);
      lines.push(
        row([
          variant,
          n,
          spread(
            runs.map((p) => p.msPerQuantum),
            4,
          ),
          n === 0 ? '—' : spread(deltas),
        ]),
      );
    }
  return [`Renders per row: ${off.filter((p) => p.n === 0).length}.`, '', ...lines];
}

function environment() {
  const e = results.map((r) => r.environment);
  const audio = ok.filter((p) => p.kind === 'audio');
  const loads = ok
    .flatMap((p) => [p.load?.before[0], p.load?.after?.[0]])
    .filter((x) => x !== undefined);
  return [
    `- Invocations: ${results.map((r) => r.started).join(', ')}`,
    `- Machine: ${e[0].cpu}, ${e[0].cores} cores, ${e[0].memoryGB} GB; ${e[0].os}; ${e[0].arch}; Node ${e[0].node}`,
    `- Chrome: ${[...new Set(e.map((x) => x.chromeVersion))].join(', ')}; ${audio[0].setup.userAgent}`,
    `- Real-time sample rates, in audio passes: ${tally(audio.map((p) => `${p.setup.sampleRate} Hz`))}; in main passes: ${tally(ok.filter((p) => p.kind === 'main').map((p) => `${p.setup.sampleRate} Hz`))}; baseLatency ${[...new Set(audio.map((p) => p.setup.baseLatency))].join(', ')} s; callback frames ${[...new Set(audio.map((p) => p.callbackFrames))].join(', ')}`,
    `- Commits: ${[...new Set(e.map((x) => x.commit))].join(', ')}; peak meter bundle sha256 ${[...new Set(e.map((x) => x.peakMeterBundleSha256))].join(', ')}`,
    `- One-minute load average across passes: ${fmt(Math.min(...loads), 2)}–${fmt(Math.max(...loads), 2)}`,
    `- Failed passes: ${failed.length}${failed.map((p) => ` (${p.kind} ${p.case} ${p.variant}: ${p.error.split('\n')[0]})`).join('')}`,
  ];
}

const sections = [
  ['Environment', environment()],
  ['Audio thread: song', audioTable('song')],
  ['Audio thread: isolated', audioTable('isolated')],
  ['Audio thread: CPU time, GC and clock', gcTable()],
  ['Reports reaching the main thread', messageRates()],
  ['Main thread', mainTable()],
  ['Offline cross-check (isolated, 48 kHz)', offlineTable()],
];
for (const [title, lines] of sections) console.log(`### ${title}\n\n${lines.join('\n')}\n`);
