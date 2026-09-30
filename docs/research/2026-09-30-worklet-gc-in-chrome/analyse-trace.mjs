/* global process, console */
// Summarises one Chrome performance trace of Windsor playback for windsor#222:
// the garbage collections on the AudioWorklet thread, and each processor's
// heap growth per `process` call from the `UpdateCounters` event Chrome emits
// after every call on that thread.
// Run: node --max-old-space-size=8192 analyse-trace.mjs <trace.json> <summary.json>
import { readFileSync, writeFileSync } from 'node:fs';

const [tracePath, summaryPath] = process.argv.slice(2);
const raw = JSON.parse(readFileSync(tracePath, 'utf8'));
const events = Array.isArray(raw) ? raw : raw.traceEvents;

/** Top-level collections, as the DevTools timeline names them. */
const GC_TOP = new Set(['MinorGC', 'MajorGC']);
/** Calls in the trace's first half second are not attributed: starting the trace moves the heap counter. */
const SETTLE_US = 500_000;
/** A counter step this large that reverses at the next reading is a blip (see below). */
const BLIP_BYTES = 64 * 1024;
/** The measured contexts ran at 44.1 kHz (`AudioContext.sampleRate` on the page). */
const SAMPLE_RATE = 44_100;
const RENDER_QUANTUM_FRAMES = 128;

const key = (e) => `${e.pid}:${e.tid}`;
const threadNames = new Map();
for (const e of events) {
  if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(key(e), e.args.name);
}
const audioKeys = [...threadNames].filter(([, name]) => name.includes('AudioWorklet'));
if (audioKeys.length !== 1) throw new Error(`expected one AudioWorklet thread, found ${audioKeys.length}`);
const [audioKey, audioThreadName] = audioKeys[0];

const onAudio = events
  .filter((e) => key(e) === audioKey && e.ph !== 'M')
  .sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));

const bundleOf = (e) => (e.args?.data?.url ?? '').split('/').pop() || '(unknown)';
const calls = onAudio.filter((e) => e.name === 'FunctionCall' && e.ph === 'X');
const collections = onAudio.filter((e) => GC_TOP.has(e.name) && e.ph === 'X');
const gcDetail = onAudio.filter((e) => e.name.startsWith('V8.GC') && e.ph === 'X');
const interrupts = onAudio.filter((e) => e.name === 'V8.HandleInterrupts' && e.ph === 'X');

const start = calls[0].ts;
const end = calls.at(-1).ts + calls.at(-1).dur;
const seconds = (end - start) / 1e6;
const midpoint = (start + end) / 2;
const within = (outer, inner) => inner.ts >= outer.ts && inner.ts < outer.ts + outer.dur;

// Heap growth per call: the counter before a call is the one after the previous call.
const readings = [];
let heapBefore = null;
let current = null;
let skipped = 0;
for (const e of onAudio) {
  if (GC_TOP.has(e.name)) heapBefore = null;
  if (e.name === 'FunctionCall' && e.ph === 'X') current = e;
  if (e.name !== 'UpdateCounters') continue;
  const heap = e.args.data.jsHeapSizeUsed;
  if (current && (heapBefore === null || current.ts < start + SETTLE_US)) skipped += 1;
  else if (current) {
    const disturbed =
      collections.some((gc) => within(current, gc)) || interrupts.some((i) => within(current, i));
    readings.push({ call: current, delta: heap - heapBefore, disturbed });
  }
  heapBefore = heap;
  current = null;
}

// The counter sometimes steps up by hundreds of KB for one reading and back down at the
// next, with no collection between: a blip in the counter, not an allocation. Both
// readings of such a pair are left out.
let blips = 0;
for (let i = 0; i + 1 < readings.length; i += 1) {
  const [a, b] = [readings[i].delta, readings[i + 1].delta];
  if (a > BLIP_BYTES && b < -BLIP_BYTES && Math.abs(a + b) < BLIP_BYTES / 4) {
    readings[i].blip = true;
    readings[i + 1].blip = true;
    blips += 1;
  }
}

const perBundle = new Map();
const messageCalls = {};
for (const { call, delta, disturbed, blip } of readings) {
  const bundle = bundleOf(call);
  if (call.args.data.functionName !== 'process') {
    const name = `${bundle} ${call.args.data.functionName}`;
    messageCalls[name] = (messageCalls[name] ?? 0) + 1;
    continue;
  }
  if (!perBundle.has(bundle)) perBundle.set(bundle, { deltas: [], late: [], durations: [], excluded: 0 });
  const entry = perBundle.get(bundle);
  entry.durations.push(call.dur);
  if (disturbed || blip) entry.excluded += 1;
  else {
    entry.deltas.push(delta);
    if (call.ts >= midpoint) entry.late.push(delta);
  }
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const round = (x, places = 1) => Math.round(x * 10 ** places) / 10 ** places;
const meanOf = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

// The output stage is one node in every song, so its calls count the render quanta. A
// bundle with several nodes (the plate insert beside the room return, the dense song's
// inserts) makes several calls a quantum; its bytes per quantum sum over them.
const quanta = perBundle.get('output-stage-processor.js').durations.length;

const bundles = Object.fromEntries(
  [...perBundle].map(([bundle, { deltas, late, durations, excluded }]) => {
    const sorted = [...deltas].sort((a, b) => a - b);
    const dur = [...durations].sort((a, b) => a - b);
    return [
      bundle,
      {
        nodes: round(durations.length / quanta, 2),
        bytesPerQuantum: round((meanOf(deltas) * durations.length) / quanta),
        calls: durations.length,
        callsMeasured: deltas.length,
        callsExcluded: excluded,
        bytesPerCallMedian: quantile(sorted, 0.5),
        bytesPerCallMean: round(meanOf(deltas)),
        bytesPerCallMeanSecondHalf: round(meanOf(late)),
        bytesPerCallMin: sorted[0],
        bytesPerCallMax: sorted.at(-1),
        callsAllocating: deltas.filter((d) => d > 0).length,
        callUsMedian: quantile(dur, 0.5),
        callUsP99: quantile(dur, 0.99),
        callUsMax: dur.at(-1),
      },
    ];
  }),
);

const gcInCall = (gc) => calls.find((c) => within(c, gc));
const gcs = collections.map((gc) => ({
  name: gc.name,
  atS: round((gc.ts - start) / 1e6, 3),
  us: gc.dur,
  insideProcessOf: gcInCall(gc) ? bundleOf(gcInCall(gc)) : null,
  usedBefore: gc.args?.usedHeapSizeBefore ?? null,
  usedAfter: gc.args?.usedHeapSizeAfter ?? null,
}));
const detailNames = {};
for (const e of gcDetail) detailNames[e.name] = (detailNames[e.name] ?? 0) + 1;

const heapCounters = onAudio.filter((e) => e.name === 'UpdateCounters').map((e) => e.args.data.jsHeapSizeUsed);

// One render quantum is the process calls from after one output-stage call up to and
// including the next: the output stage is the graph's last node. A collection outside any
// call is charged to the quantum after it, as its duration plus that quantum's span, which
// assumes the collection delayed it (it may instead have run while the thread was idle).
const quantumBudgetUs = (RENDER_QUANTUM_FRAMES / SAMPLE_RATE) * 1e6;
const spans = [];
const spansAfterGc = [];
let quantumStart = null;
let gcBefore = 0;
for (const e of onAudio) {
  if (e.ph !== 'X') continue;
  if (GC_TOP.has(e.name) && !gcInCall(e)) gcBefore += e.dur;
  if (e.name !== 'FunctionCall' || e.args.data.functionName !== 'process') continue;
  quantumStart ??= e.ts;
  if (bundleOf(e) !== 'output-stage-processor.js') continue;
  const span = e.ts + e.dur - quantumStart;
  if (quantumStart < start + SETTLE_US) {
    // Starting the trace stalls the thread (the profiler starts): not a render cost.
  } else if (gcBefore > 0) spansAfterGc.push(span + gcBefore);
  else spans.push(span);
  quantumStart = null;
  gcBefore = 0;
}
const spanStats = (xs) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return {
    quanta: xs.length,
    medianUs: quantile(sorted, 0.5) ?? null,
    p99Us: quantile(sorted, 0.99) ?? null,
    maxUs: sorted.at(-1) ?? null,
    overBudget: xs.filter((x) => x > quantumBudgetUs).length,
  };
};

const summary = {
  trace: tracePath.split('/').pop(),
  audioThread: audioThreadName,
  seconds: round(seconds, 3),
  processCalls: calls.length,
  callsNotAttributed: skipped,
  counterBlips: blips,
  messageCalls,
  processUsPerSecond: round(calls.reduce((s, c) => s + c.dur, 0) / seconds),
  collections: {
    minor: gcs.filter((g) => g.name === 'MinorGC').length,
    major: gcs.filter((g) => g.name === 'MajorGC').length,
    perSecond: round(gcs.length / seconds, 3),
    longestUs: gcs.reduce((m, g) => Math.max(m, g.us), 0),
    totalUs: gcs.reduce((s, g) => s + g.us, 0),
    insideProcess: gcs.filter((g) => g.insideProcessOf !== null).length,
    list: gcs,
  },
  quantumBudgetUs: round(quantumBudgetUs),
  quantumSpans: spanStats(spans),
  quantumSpansAfterGc: spanStats(spansAfterGc),
  gcPhaseEvents: detailNames,
  heapUsed: { first: heapCounters[0], last: heapCounters.at(-1), min: heapCounters.reduce((m, x) => Math.min(m, x), Infinity), max: heapCounters.reduce((m, x) => Math.max(m, x), 0) },
  bundles,
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, collections: { ...summary.collections, list: undefined } }, null, 1));
