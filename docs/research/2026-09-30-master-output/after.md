# The Mixer tab's main-thread cost, after the master column (windsor#194)

The "after" for `baseline.md` beside it (record
`2026-09-30-master-column-and-meters`, decision 11; windsor#194 decision 10),
taken the same way on the same machine and browser.

## Where and how

- **Machine:** Apple M1 (8 cores, 16 GB), macOS 26.5.1.
- **Browser:** the project's headless Chrome 154 (`HeadlessChrome/154`),
  the `chrome-devtools-mcp` instance in `.mcp.json`, a 1440 × 900 viewport
  at a device pixel ratio of 1. Its display runs at 59 frames a second.
- **Backend:** a live `AudioContext` on the headless browser's default
  output. The app was `feature/194-master-column` on `c2297e7`, served by the
  Vite dev server (`npm run dev -w packages/app -- --port 5294`).
- **Song:** the engine's `FULL_DOCUMENT` fixture, imported through
  Settings, audio enabled, playing on loop. It drives the stage into the
  limiter at the default −1 dBFS ceiling, so every bar, the GR bar, the
  curve's dot and the lamp moved.
- **Traces:** as in the baseline, `performance_start_trace` with no reload,
  a 4 s wait, `performance_stop_trace`, about 4.15 s of trace each, read
  with the baseline's script, unchanged.
- **Cases:** the baseline's "Mixer, top" and "Mixer, meters in view" are
  one case now: at 1440 px the master column's meters are on screen when
  the tab opens, and the column is sticky. So the cases are "Mixer" and
  "Song", two traces each, taken back to back in one session.

## The transition

The first build kept decision 10's short transition between reports (34 ms
on each bar's cover and hold line). Its traces showed the Mixer costing
more than the baseline's, and a trace with the transitions switched off in
the page read about 12 ms a second less rendering and 6 ms less other task
time. A
transition restarted every 33 ms keeps an animation running on the main
thread all the time. The shipped build steps the bars at the report rate
with no transition. Both are recorded below.

## Results

Milliseconds of main-thread time per second of wall time, each case's two
traces side by side:

| Case | Scripting | Rendering | Painting | Other | Tracing (left out) |
|---|---|---|---|---|---|
| Mixer, shipped (no transition) | 30.1 · 33.4 | 26.4 · 28.1 | 10.7 · 11.7 | 23.5 · 25.8 | 22.0 · 20.6 |
| Song, beside it | 32.3 · 31.8 | 21.8 · 20.2 | 9.8 · 9.1 | 23.6 · 22.2 | 25.0 · 22.9 |
| Mixer, first build (34 ms transition) | 27.2 · 23.7 | 38.7 · 36.3 | 13.1 · 11.2 | 27.8 · 25.7 | 23.7 · 19.8 |
| Song, beside it | 24.7 · 21.4 | 18.8 · 20.9 | 8.3 · 9.1 | 17.3 · 16.7 | 20.6 · 21.4 |

Events per second:

| Case | Frames scheduled (`requestAnimationFrame`) | Frames drawn | Style recalcs | Layouts | Paints | Timers |
|---|---|---|---|---|---|---|
| Mixer, shipped | 177.2 · 176.6 | 59.1 · 58.9 | 71.9 · 71.4 | 66.8 · 67.1 | 83.3 · 83.8 | 41.2 · 41.4 |
| Song, beside it | 117.3 · 118.1 | 58.7 · 59.0 | 48.9 · 51.2 | 38.9 · 39.2 | 166.9 · 173.1 | 41.0 · 41.6 |
| Mixer, first build | 176.3 · 176.9 | 58.8 · 59.0 | 86.8 · 87.3 | 66.9 · 67.4 | 83.7 · 85.1 | 41.2 · 41.5 |
| Song, beside it | 118.1 · 118.1 | 59.0 · 59.0 | 49.9 · 48.9 | 39.0 · 39.5 | 165.1 · 167.4 | 41.4 · 41.7 |

## Against the baseline

The absolute figures moved between the two sessions on every case, the
Song tab's too (its scripting read 19 to 20 ms a second in the baseline and
21 to 32 here), so the comparison that holds is each session's Mixer less
its own Song tab, the page's cost of showing the Mixer. Each figure is the
mean of a case's traces (the baseline's Mixer is its four, both cases):

| Mixer less Song | Scripting | Rendering | Painting | Other | Sum |
|---|---|---|---|---|---|
| Baseline (`<meter>` bars, `da4769b`) | +0.1 | +9.4 | +6.4 | +0.7 | +16.6 |
| After, shipped | −0.3 | +6.3 | +1.8 | +1.8 | +9.5 |
| After, first build (34 ms transition) | +2.4 | +17.7 | +3.5 | +9.8 | +33.3 |

- **Showing the Mixer costs about 7 ms a second less than before**: 3 ms
  less style and layout work and nearly 5 ms less painting. Paints fall
  from 131 a second to 84: a cover moved with `transform` on its own layer
  repaints nothing.
- **Layouts still run once per report.** The Mixer lays out about 67 times
  a second against the Song tab's 39: the readouts' text changes when a
  held value moves by a tenth of a dB, 30 times a second at most. Most of
  the page's style and layout passes are the top bar's scope
  (`scope.ts`), which reads the layout on every frame on every tab, as in
  the baseline.
- **The meter loop asks for one frame per drawn frame while the Mixer is
  seen** (177 against 118 frame requests a second), and paints only on the
  frames where a report landed.

## With the Song tab shown

- **No frames are scheduled for the Mixer's meters.** The Song tab's traces
  read 118 frame requests a second, the baseline's two per frame. A 2 s
  wrap of `requestAnimationFrame` on the Song tab counted 121 requests from
  the shared driver (`stepStrip.ts`) and 121 from the scope (`scope.ts`),
  and none from `meterLoop.ts`. The same wrap with the Mixer shown counted
  120 from each of the three.
- The baseline's hidden Mixer cost a call and a `closest('[hidden]')` per
  watch per frame; the new loop costs nothing until the tab is shown again.

## Limits

The baseline's: one machine, one browser, headless, at 59 frames a second
and a device pixel ratio of 1, two short traces per case, and tracing
itself costing about 20 ms a second. The sessions differ in their absolute
figures, so only the per-session differences above are compared. The first
build's and the shipped build's traces came from the same page, with the
transitions removed in between.
