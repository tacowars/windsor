/** windsor#533: reduces one pass's trace events to the numbers the README reports.
 *
 * Audio thread: Chrome's `RealtimeAudioDestinationHandler::Render` event (category
 * `webaudio`) spans one 128-frame render of the whole graph, every node's `process` in it,
 * on the `Realtime AudioWorklet thread`. Its `dur` is wall time and `tdur` the thread's
 * CPU time. A collection runs as its own task between renders (`2026-09-30-worklet-gc-in-
 * chrome`), so it is counted apart, from the top-level `disabled-by-default-v8.gc` events.
 *
 * Main thread: the page's `CrRendererMain` top-level tasks, and among them the tasks that
 * run a port's `onmessage`, which is where a meter report is deserialised and handled.
 */
const WORKLET_THREAD = 'Realtime AudioWorklet thread';
const MAIN_THREAD = 'CrRendererMain';
const RENDER = 'RealtimeAudioDestinationHandler::Render';
const REQUEST = 'AudioDestination::RequestRender';
const TASK = 'ThreadControllerImpl::RunTask';
const SCAVENGE = 'V8.GC_SCAVENGER';
const MAJOR = ['V8.GC_MARK_COMPACTOR', 'V8.GC_MINOR_MARK_SWEEPER'];
const US_PER_MS = 1000;
const US_PER_S = 1e6;

const key = (e) => `${e.pid}:${e.tid}`;
const gcEvent = (e) => e.cat.includes('v8.gc');
const ms = (list) => list.reduce((sum, e) => sum + e.dur, 0) / US_PER_MS;

function threadNames(events) {
  const names = new Map();
  for (const e of events)
    if (e.ph === 'M' && e.name === 'thread_name') names.set(key(e), e.args.name);
  return names;
}

/** The worklet thread with the most renders: the page's, since one page runs at a time. */
function workletThread(events, names) {
  const counts = new Map();
  for (const e of events)
    if (e.name === RENDER && e.ph === 'X' && names.get(key(e)) === WORKLET_THREAD)
      counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function stats(values, percentile) {
  if (values.length === 0) return null;
  const sorted = Float64Array.from(values).sort();
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { count: sorted.length, mean, p50: at(0.5), p95: at(percentile), max: sorted.at(-1) };
}

/** Complete events on `thread` that no earlier event of the same filter contains. */
function topLevel(events, thread, match) {
  const own = events
    .filter((e) => e.ph === 'X' && key(e) === thread && match(e))
    .sort((a, b) => a.ts - b.ts);
  const out = [];
  let end = -Infinity;
  for (const e of own) {
    if (e.ts < end) continue;
    out.push(e);
    end = e.ts + e.dur;
  }
  return out;
}

/** The members of `outer` (sorted, disjoint) that some member of `inner` (sorted) starts in. */
function containing(inner, outer) {
  const found = new Set();
  let o = 0;
  for (const e of inner) {
    while (o < outer.length && outer[o].ts + outer[o].dur < e.ts) o++;
    if (o < outer.length && outer[o].ts <= e.ts) found.add(outer[o]);
  }
  return [...found];
}

/** The page's `meters:<n>` marks, in order: each opens a segment the next one closes. */
function segmentsOf(events, guardSeconds) {
  const marks = events
    .filter((e) => e.cat.includes('blink.user_timing') && /^meters:\d+$/.test(e.name))
    .sort((a, b) => a.ts - b.ts);
  const unique = marks.filter((m, i) => i === 0 || m.ts !== marks[i - 1].ts);
  return unique.slice(0, -1).map((m, i) => ({
    n: Number(m.name.split(':')[1]),
    from: m.ts + guardSeconds * US_PER_S,
    to: unique[i + 1].ts,
  }));
}

/** One segment set's render time (wall and CPU, µs), clock check and GC on the audio thread. */
function measureRanges(renders, gcTop, scavenges, ranges, percentile) {
  const inside = (e) => ranges.some((r) => e.ts >= r.from && e.ts < r.to);
  const own = renders.filter(inside);
  const seconds = ranges.reduce((sum, r) => sum + (r.to - r.from), 0) / US_PER_S;
  const gc = gcTop.filter(inside);
  return {
    wallUs: stats(
      own.map((e) => e.dur),
      percentile,
    ),
    cpuUs: stats(
      own.map((e) => e.tdur ?? e.dur),
      percentile,
    ),
    seconds,
    quantaPerSecond: own.length / seconds,
    gc: {
      scavengesPerSecond: scavenges.filter(inside).length / seconds,
      msPerSecond: ms(gc) / seconds,
      maxPauseUs: gc.reduce((max, e) => Math.max(max, e.dur), 0),
      rendersHoldingGc: containing(gc, own).length,
    },
  };
}

/**
 * The audio pass: per N, the renders of every segment at that count pooled (`byN`), and
 * each segment's own mean (`segments`), so a delta can be paired with its neighbours.
 */
export function audioPass(events, percentile, guardSeconds) {
  const names = threadNames(events);
  const thread = workletThread(events, names);
  if (!thread) return { error: 'no render events on a worklet thread' };
  const own = (match) =>
    events.filter((e) => e.ph === 'X' && key(e) === thread && match(e)).sort((a, b) => a.ts - b.ts);
  const renders = own((e) => e.name === RENDER);
  const gc = topLevel(events, thread, gcEvent);
  const scavenges = own((e) => e.name === SCAVENGE);
  const ranges = segmentsOf(events, guardSeconds);
  if (ranges.length === 0) return { error: 'no segment marks in the trace' };
  const request = events.find((e) => e.name === REQUEST && key(e) === thread);
  const byN = {};
  for (const n of [...new Set(ranges.map((r) => r.n))].sort((a, b) => a - b))
    byN[n] = measureRanges(
      renders,
      gc,
      scavenges,
      ranges.filter((r) => r.n === n),
      percentile,
    );
  return {
    byN,
    segmentMeansUs: ranges.map((r) => ({
      n: r.n,
      wall: measureRanges(renders, gc, scavenges, [r], percentile).wallUs?.mean ?? null,
    })),
    callbackFrames: request?.args?.frames_requested ?? null,
    majorGcInPass: own((e) => MAJOR.includes(e.name)).length,
  };
}

/**
 * The page's main thread: busy time, and the port handlers. A port's handler shows as a
 * `FunctionCall` named `…onmessage` (a MessagePort message raises no `EventDispatch`); its
 * task, which also deserialises the message, is the top-level task that contains it. The
 * song's own processors post too (their load reports), so the N = 0 pass is the baseline.
 */
export function mainPass(events) {
  const names = threadNames(events);
  // The page's renderer is the process that has a worklet thread.
  const worklet = [...names].find(([, name]) => name === WORKLET_THREAD);
  const pid = worklet ? worklet[0].split(':')[0] : null;
  const thread = [...names].find(([k, name]) => name === MAIN_THREAD && k.startsWith(`${pid}:`));
  if (!thread) return { error: 'no main thread in the page process' };
  const main = thread[0];
  const tasks = topLevel(events, main, (e) => e.name === TASK);
  if (tasks.length === 0) return { error: 'no tasks on the main thread' };
  const handlers = events
    .filter(
      (e) =>
        e.ph === 'X' &&
        key(e) === main &&
        e.name === 'FunctionCall' &&
        /onmessage$/.test(e.args?.data?.functionName ?? ''),
    )
    .sort((a, b) => a.ts - b.ts);
  const spanSeconds = (tasks.at(-1).ts + tasks.at(-1).dur - tasks[0].ts) / US_PER_S;
  const handlerTasks = containing(handlers, tasks);
  return {
    spanSeconds,
    busyMsPerSecond: ms(tasks) / spanSeconds,
    handlersPerSecond: handlers.length / spanSeconds,
    handlerMsPerSecond: ms(handlers) / spanSeconds,
    handlerTasksPerSecond: handlerTasks.length / spanSeconds,
    handlerTaskMsPerSecond: ms(handlerTasks) / spanSeconds,
    gcMsPerSecond: ms(topLevel(events, main, gcEvent)) / spanSeconds,
  };
}
