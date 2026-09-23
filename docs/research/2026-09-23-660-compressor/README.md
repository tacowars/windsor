# Compressor insert: standalone editor and indicative audio load

Ticket #660; 2026-09-23. Apple M1, macOS Darwin 25.5.0, Chrome
153.0.8010.53, headless Web Audio / AudioWorklet, 48 kHz. Development
machine only; no claim about the Ryzen/Vega target or a rendered game frame.

Run from the ticket checkout with Node 24:

```sh
node docs/research/2026-09-23-660-compressor/collect.mjs
```

The page is the generated standalone `file://` editor from this checkout.
`browser.json` records its SHA-256, the parent commit (the worktree was dirty),
the real processor parameters, the active meter, the exported settings and
all load reports. The page's hash is `bd8797ebfd1a7bd9abf2b4c5d946af8cdbd630e8e622b96a82eb1197c3bc0575`.

The script imports a normalized one-part Init song with a compressor,
enables audio, changes ratio to 10:1, attack to 0.3 ms and release to 0.4 s,
and holds the QWERTY A note. It asserts positive gain reduction, captures
`editor.png`, releases the note, bypasses compression, asserts zero metering,
and exports `audition-song.json`. The export assertion checks all three
changed stepped controls and bypass. The song is a test fixture, not a
proposed soundtrack. `console.json` contains the complete console/pageerror
transcript: zero warnings/errors. `network.json` contains all completed and
failed page request events: no failed requests.

The screenshot is for Pat; the processor values and document assertions are
the evidence. A game-world movement/screenshot collector cannot express this
standalone UI scenario (decision record, item 7).

## Audio load

A separate context per case runs 0, 1, 8 or 16 independent compressor paths
from one native 220 Hz oscillator, mixed into a muted output gain. The zero
output gain does not skip work: every processor emits the retained load
reports. Each compressor uses -24 dB threshold, 4:1, 10 ms attack, Auto release.
After 0.5 s warmup, 3.5 s is sampled with one report per second. Gain-reduction
UI telemetry is off for these paths. The editor's original context remains
alive; these readings isolate only the new paths' self-reported DSP cost.

| Instances | Sum of reported DSP duty-cycle estimates | Output underrun events |
|---|---:|---:|
| 0 | no compressor reports | 0 |
| 1 | 0.7% | 0 |
| 8 | 4.0% | 0 |
| 16 | 6.3% | 0 |

The existing `Date.now()` estimator has 1 ms resolution and known bias; these
are rounded estimates, not precise CPU utilization. Each row sums per-node
`100 × sum(busyMs) / sum(wallMs)`. No sampled DSP deadline misses occurred.
This short, synthetic run establishes functioning instrumentation and no
observed underruns, not a worst-case game budget. The target-box follow-up
should run an actual eight-part song with 16 inserts during gameplay, checking
output underruns and game-frame gates.

`initial-browser.json` is the superseded first reading (0.4/4.1/6.5%), retained
for provenance. After it, the Auto-to-manual release switch was made continuous
and given a regression test; `browser.json` is the refreshed reading.

## Listening

Pat's verdict is pending. Open the ticket worktree's editor, enable audio,
import a familiar song, Mixer → Add insert → Bus compressor. Begin with 2:1
or 4:1, 10 ms, Auto and 2–4 dB reduction, level-match with Makeup, and compare
transients/recovery/bypass with The Glue. Try short manual releases and heavy
compression too. Detector HP should reduce bass-driven pumping without cutting
audible bass; Range should limit reduction. This implementation deliberately
approximates the detector and Range behavior; it does not claim circuit identity.
