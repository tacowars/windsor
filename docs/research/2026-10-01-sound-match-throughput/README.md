# Sound-match throughput

2026-10-01 · windsor#282. How fast `scripts/sound-match/` renders and fits,
for comparing later changes against. The toolkit and its decisions are in
`docs/log/2026-10-01-sound-match-toolkit.md`.

## Machine and backend

Apple M1 (8 cores, 16 GB), macOS 26.5.1, Node 24.21.0, Python 3.12.9. The
backend is the shipped `packages/engine/src/worklet/generated/fm-processor.js`
run in Node by `scripts/sound-match/render.mjs` (no browser, no Web Audio).
The machine was shared with other work during every run, so the ranges are
wide.

## Method

- **One-shot:** `node render.mjs tr909-kick --seconds 1`, timed wall to
  wall: one Node start-up, one bundle evaluation, one render.
- **Server:** `python renderer.py <patch> --seconds 1 --count 200`. One Node
  process; 20 warm-up renders are discarded, then 200 one-second renders are
  timed through the JSON-lines protocol.
- **Fit:** `python fit.py specs/tr909-kick.json` (CMA-ES, a budget of 600
  evaluations, renders of 0.39 s, the reference read through
  `$SM_909_KICKS`). `fit.py` prints the wall time, renders per second over
  the whole run, and renders per second inside the renderer alone.

## Results

| Measurement | Patch | Result |
|---|---|---|
| One-shot render | `tr909-kick` | 70 ms wall, nearly all of it Node start-up and evaluating the bundle |
| Server | `tr909-kick` | 460–615 renders/s over three runs |
| Server | `tr808-clap` | 700 renders/s |
| Fit, 600 evaluations | `tr909-kick` | 16 s and 27 s on two runs (22–37 evaluations/s), 287–537 renders/s inside the renderer |
| Fit, 600 evaluations, a third run later the same day | `tr909-kick` | 602 renders in 10.9 s (55 renders/s overall), 807 renders/s inside the renderer |

## Reading

- The server renders several hundred times real time. Node's start-up is
  what a one-shot pays, so a fit keeps one process for all its renders.
- A fit is bound by the analysis in Python, not by the render.
- The first two fit runs ended on the same patch: a seeded CMA-ES over
  seeded renders is reproducible.
