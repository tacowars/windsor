# The Mixer tab's main-thread cost, before the new meters (windsor#193)

The master column's record (`docs/log/2026-09-30-master-column-and-meters.md`,
decision 11) asks for the Mixer tab's main-thread cost before and after the
meters are replaced. windsor#193 decision 7 asks for the "before", taken
before any of its code changed. This note is that measurement. windsor#194
records the "after" the same way.

## Where and how

- **Machine:** Apple M1 (8 cores, 16 GB), macOS 26.5.1.
- **Browser:** headless Chrome 154 (`HeadlessChrome/154.0.8037.58`), the
  project's `chrome-devtools-mcp` 1.10.1 instance (`.mcp.json`), a
  1440 × 900 viewport at a device pixel ratio of 1, GPU "ANGLE Metal
  Renderer: Apple M1". Its display runs at 59 frames a second.
- **Backend:** a live `AudioContext` at 44.1 kHz (base latency 5.8 ms,
  output latency 32 ms) on the headless browser's default output. The app
  was `main` at `da4769b`, served by the Vite dev server
  (`npm run dev -w packages/app -- --port 5293`).
- **Song:** the engine's `FULL_DOCUMENT` fixture
  (`__fixtures__/fullArrangement.ts`: four parts, 96 BPM, four bars),
  imported through Settings, audio enabled, playing on loop. The Mixer's
  seven `<meter>` bars (the master's L and R, the output stage's In L, In R,
  Out L, Out R and GR) all moved.
- **Traces:** `performance_start_trace` with no reload, a 4 s wait, then
  `performance_stop_trace` to a `.json.gz` file, about 4.2 s of trace each.
  Two traces per case, in this order:
  1. **Mixer, top:** the Mixer tab shown and scrolled to the top, as it
     opens. The meters sit below the fold at this size.
  2. **Mixer, meters in view:** the same, scrolled so all seven meters are
     on screen.
  3. **Song:** the Song tab shown, the Mixer tab hidden.
- **Reading:** the script at the end of this note. It takes the page's
  main thread (the busiest `CrRendererMain`), computes each trace event's
  self time (the event less the events nested in it) and sums it by the
  kinds DevTools uses. Scripting is function calls, timers, animation
  frames, microtasks and GC. Rendering is style recalculation, layout,
  pre-paint, layerize and intersection checks. Painting is paint and
  commit. Other is the task scheduler's own time and the rest. The
  profiler's start-up (`CpuProfiler::StartProfiling`, `ScriptCatchup`) is
  the trace's own cost, so it is counted apart and left out. Frames
  scheduled is the rate of `RequestAnimationFrame` events. Frames drawn is
  the rate of `BeginMainThreadFrame`.

## Results

Milliseconds of main-thread time per second of wall time, each case's two
traces side by side:

| Case | Scripting | Rendering | Painting | Other | Tracing (left out) |
|---|---|---|---|---|---|
| Mixer, top | 19.3 · 19.2 | 28.5 · 28.5 | 18.1 · 18.2 | 14.0 · 14.6 | 20.1 · 21.0 |
| Mixer, meters in view | 19.3 · 21.5 | 27.6 · 27.4 | 17.4 · 17.5 | 13.6 · 13.9 | 18.4 · 21.5 |
| Song | 19.2 · 20.3 | 18.1 · 19.1 | 11.1 · 11.8 | 12.7 · 13.9 | 22.6 · 18.3 |

Events per second:

| Case | Frames scheduled (`requestAnimationFrame`) | Frames drawn | Style recalcs | Layouts | Paints | Timers |
|---|---|---|---|---|---|---|
| Mixer, top | 117.6 · 117.9 | 59.1 · 59.0 | 53.6 · 53.5 | 51.7 · 52.1 | 130.7 · 130.7 | 41.5 · 41.7 |
| Mixer, meters in view | 118.3 · 118.2 | 59.2 · 59.1 | 53.9 · 53.6 | 52.3 · 52.0 | 130.7 · 130.3 | 41.6 · 41.5 |
| Song | 117.9 · 118.5 | 59.0 · 59.2 | 49.5 · 49.2 | 38.6 · 38.8 | 164.3 · 168.0 | 41.2 · 41.6 |

## How to read them

- **Two frame requests every frame, on either tab.** A 2 s wrap of
  `requestAnimationFrame` on the Song tab counted 120 requests from the
  console's shared driver (`stepStrip.ts`, which `watchPlayhead` rides) and
  120 from the top bar's scope (`scope.ts`): one each per drawn frame. The
  shared driver keeps asking for a frame with the Mixer tab hidden. The
  Mixer's two meter watches (`masterMeter.ts` and `outputStageMeters.ts`)
  then find their roots under `[hidden]` and return, so a hidden Mixer
  costs a call and a `closest('[hidden]')` per watch per frame, not a
  paint. The new loop's point is to ask for no frame at all in that case.
- **Scripting does not separate the tabs.** It reads about 19 to 21 ms a
  second on all three. Whatever the Mixer's meter watches cost is below
  what the Song tab's own playhead watches cost in its place, and within
  the traces' spread (19.3 against 21.5 for the same case).
- **Rendering and painting do.** With the Mixer shown, rendering reads
  about 28 ms a second and painting about 18, against about 18.6 and 11.5
  on the Song tab: about 9.5 ms a second more style and layout work and
  6.5 more paint and commit, about 16 ms a second in all. Layouts run
  about 52 times a second on the Mixer against about 39 on the Song tab,
  the pattern of `<meter>` value changes at the stage's 30 Hz report
  forcing a layout on frames where nothing else would.
- **Scrolling the meters out of view saves nothing.** The Mixer at the top,
  with every meter below the fold, costs the same as the Mixer with all
  seven on screen (28.5 against 27.5 ms rendering, the same layout count).
  A `<meter>` off screen still takes its style and layout pass.
- **These figures are the whole page**, not the meters alone: the playing
  transport, the top bar's CPU meter, scope and output light, and the rest
  of the Mixer (the send racks' knobs) are in every case. The comparison
  that isolates the meters is the "after" in windsor#194 against these, on
  the same machine, browser, song and cases.

## Limits

One machine, one browser, headless, at 59 frames a second and a device
pixel ratio of 1: a 120 Hz or high-DPI display changes the per-frame costs.
Each trace is about 4.2 s, and a longer one failed to save (the DevTools
protocol's `IO.read` refused it), so the table gives two short traces per
case rather than one long one. Tracing itself costs the main thread about
20 ms a second, counted apart above.

## The reading script

Run as `node trace-cost.mjs <trace.json.gz>` on a trace saved by
`performance_stop_trace`:

```js
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
const raw = readFileSync(file);
const data = JSON.parse((file.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8'));
const events = Array.isArray(data) ? data : data.traceEvents;
const key = (e) => `${e.pid}:${e.tid}`;

// The busiest CrRendererMain thread is the page's main thread.
const mains = new Set(
  events
    .filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
    .map(key),
);
const sizes = new Map();
for (const e of events) if (mains.has(key(e))) sizes.set(key(e), (sizes.get(key(e)) ?? 0) + 1);
const main = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
const mine = events.filter((e) => key(e) === main && e.ts > 0);

// Spans (X, and B/E pairs), then self time: a span less the spans nested in it.
const spans = [];
const open = [];
for (const e of mine) {
  if (e.ph === 'X' && typeof e.dur === 'number') spans.push({ name: e.name, ts: e.ts, end: e.ts + e.dur });
  else if (e.ph === 'B') open.push(e);
  else if (e.ph === 'E' && open.length) {
    const b = open.pop();
    spans.push({ name: b.name, ts: b.ts, end: e.ts });
  }
}
spans.sort((a, b) => a.ts - b.ts || b.end - a.end);
const stack = [];
for (const s of spans) {
  while (stack.length && stack.at(-1).end <= s.ts) stack.pop();
  s.self = s.end - s.ts;
  if (stack.length && s.end <= stack.at(-1).end) stack.at(-1).self -= s.end - s.ts;
  stack.push(s);
}

// DevTools' kinds. The profiler's own start-up is the trace's cost, not the page's.
const TRACING = /^(CpuProfiler::StartProfiling|ScriptCatchup)$/;
const SCRIPTING =
  /^(FunctionCall|EvaluateScript|TimerFire|FireAnimationFrame|EventDispatch|RunMicrotasks|FireIdleCallback|RequestAnimationFrame|CancelAnimationFrame|TimerInstall|TimerRemove|v8\.|V8\.|CppGC|BlinkGC|MajorGC|MinorGC)/;
const RENDERING =
  /^(UpdateLayoutTree|Layout|PrePaint|Layerize|HitTest|ScheduleStyleRecalculation|InvalidateLayout|UpdateLayerTree|IntersectionObserverController::computeIntersections|ParseAuthorStyleSheet|LayoutShift)$/;
const PAINTING = /^(Paint|PaintImage|Commit|CompositeLayers|Decode Image|RasterTask)$/;
const kinds = { scripting: 0, rendering: 0, painting: 0, other: 0, tracing: 0 };
for (const s of spans) {
  const kind = TRACING.test(s.name)
    ? 'tracing'
    : SCRIPTING.test(s.name)
      ? 'scripting'
      : RENDERING.test(s.name)
        ? 'rendering'
        : PAINTING.test(s.name)
          ? 'painting'
          : 'other';
  kinds[kind] += s.self;
}

const seconds = (Math.max(...mine.map((e) => e.ts + (e.dur ?? 0))) - Math.min(...mine.map((e) => e.ts))) / 1e6;
const msPerSecond = Object.fromEntries(
  Object.entries(kinds).map(([k, us]) => [k, +(us / 1000 / seconds).toFixed(1)]),
);
const rate = (name) => +(mine.filter((e) => e.name === name && e.ph !== 'E').length / seconds).toFixed(1);
console.log(
  JSON.stringify({
    file,
    seconds: +seconds.toFixed(2),
    msPerSecond,
    perSecond: {
      requestAnimationFrame: rate('RequestAnimationFrame'),
      beginMainThreadFrame: rate('BeginMainThreadFrame'),
      updateLayoutTree: rate('UpdateLayoutTree'),
      layout: rate('Layout'),
      paint: rate('Paint'),
      timerFire: rate('TimerFire'),
    },
  }),
);
```
