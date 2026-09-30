# What 16 part-strip meters cost (windsor#155)

Each part strip now carries a sample-peak meter (`PartStrip.meter`), the
`a204-peak-meter` worklet on the rotation's output, built only while the
app has made it active. Decision 5 of the issue asks for the CPU cost of 16
active meters against none, measured. This note is that measurement.

## Where and how

- **Machine:** Apple M1 (8 cores), macOS 26.5.1.
- **Browser:** headless Chrome 154 (`HeadlessChrome/154.0.0.0`), the
  project's `chrome-devtools-mcp` 1.10.1 instance (`.mcp.json`).
- **Backend:** `OfflineAudioContext` at 48 kHz, stereo, 128-frame render
  quanta. The worklet is the generated
  `worklet/generated/peak-meter-processor.js` at `ffa1037` (unchanged by
  this branch), served by the Vite dev server.
- **Script:** `bench.js`, run as one `evaluate_script` on a page of the dev
  server with the worklet's `/@fs/…` URL. Raw numbers: `chrome.json`.

The method is the output stage's
(`docs/research/2026-09-29-output-stage-cost/`). Each render is 30 s of 16
parts, each a stereo two-tone program under a slow envelope from an
`AudioBufferSource`, through the dry path `stripTap.ts` builds (head gain,
audible gate, splitter, four rotation gains, merger) into one bus gain and
the destination. The metered render adds, on each strip's rotation output,
one meter wired as `createPeakMeter` wires it: the worklet node into a
silent gain into the destination. The parts' FM worklets, inserts and sends
are left out, so the difference is the meters and nothing else.

An offline context renders as fast as it can, so a render's wall time is
the graph's CPU time on the render thread. Each kind was rendered seven
times, interleaved, after one warm-up render; the result is the median,
less the unmetered render's median, per second of audio.

## Results

| Render | Median (30 s of audio) | Over none, per second of audio |
|---|---|---|
| 16 strips, no meters | 359.8 ms | 0 |
| 16 strips, 16 active meters | 968.6 ms | 20.3 ms |

The seven runs of each kind sit within about ±3 % of its median (see
`chrome.json`).

- **16 active meters cost about 20 ms of render-thread time per second of
  audio,** about 1.3 ms a second each: about 2 % of one core in real time
  for all 16. That is close to what one worklet node costs in this backend
  (the output stage's `off` mode, a bare worklet with a peak measurement,
  read 1.17 ms a second), so the cost is the node, not the peak loop.
- It is more than the whole unmetered 16-strip render here (about 12 ms a
  second). It is paid only while meters are active, since an inactive
  meter builds nothing (decision 3), so the cost follows how many lights
  the app has switched on.
- The meters posted 13,840 reports in the last metered run, against the
  14,400 that 16 meters at 30 Hz over 30 s would send; the rest were still
  queued when the count was read, 200 ms after rendering ended. Handling
  them is main-thread work, which this render time does not include.

## Limits

These are offline renders, not a live `AudioContext` during playback: they
say what the meters cost the render thread, not whether a given machine
drops out with a full song playing. One machine, one browser. The Node
harness is not a cost measurement and nothing here was measured in it.
