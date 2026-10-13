/** Reduces a realtime trace to the audio thread's per-quantum render spans and collections.
 * `RealtimeAudioDestinationHandler::Render` (category `webaudio`) spans one render of the
 * whole graph on the `Realtime AudioWorklet thread`; `dur` is its wall time, `tdur` its CPU
 * time. Collections run between renders as their own tasks (`disabled-by-default-v8.gc`).
 */
const WORKLET_THREAD = 'Realtime AudioWorklet thread';
const RENDER = 'RealtimeAudioDestinationHandler::Render';
const US_PER_S = 1e6;

const key = (e) => `${e.pid}:${e.tid}`;

function threadNames(events) {
  const names = new Map();
  for (const e of events)
    if (e.ph === 'M' && e.name === 'thread_name') names.set(key(e), e.args.name);
  return names;
}

export function stats(values, budgetUs) {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  let over = 0;
  for (const v of sorted) if (v > budgetUs) over++;
  return {
    count: sorted.length,
    mean,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
    overBudget: over,
    budgetUs,
  };
}

/** The spans of every render on the busiest worklet thread, after the first `guardSeconds`. */
export function audioPass(events, sampleRate, guardSeconds = 0.5) {
  const names = threadNames(events);
  const renders = events.filter(
    (e) => e.name === RENDER && e.ph === 'X' && names.get(key(e)) === WORKLET_THREAD,
  );
  const counts = new Map();
  for (const e of renders) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  const thread = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const own = renders.filter((e) => key(e) === thread).sort((a, b) => a.ts - b.ts);
  if (own.length === 0) return { renders: null };
  const start = own[0].ts + guardSeconds * US_PER_S;
  const kept = own.filter((e) => e.ts >= start);
  const budgetUs = (128 / sampleRate) * US_PER_S;
  const gc = events
    .filter((e) => e.ph === 'X' && key(e) === thread && e.cat.includes('v8.gc') && e.ts >= start)
    .sort((a, b) => a.ts - b.ts);
  // Top-level collections only: drop events nested in an earlier one.
  const top = [];
  let end = -Infinity;
  for (const e of gc) {
    if (e.ts < end) continue;
    top.push(e);
    end = e.ts + e.dur;
  }
  const seconds = (kept.at(-1).ts - kept[0].ts) / US_PER_S;
  return {
    seconds,
    renders: stats(kept.map((e) => e.dur), budgetUs),
    cpu: stats(kept.map((e) => e.tdur ?? e.dur), budgetUs),
    quantaPerSecond: kept.length / seconds,
    gc: {
      count: top.length,
      perSecond: top.length / seconds,
      msPerSecond: top.reduce((s, e) => s + e.dur, 0) / 1000 / seconds,
      longestUs: top.reduce((m, e) => Math.max(m, e.dur), 0),
    },
  };
}
