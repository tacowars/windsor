# What the Filter insert costs (windsor#622)

Decision 8 of windsor#622: the insert's cost in each mode on a stereo part
with steady input, measured in the project's headless Chrome, beside one
Acid voice for reference.

## Setup

- **Machine:** Apple M1 (8 cores), macOS 26.7.1, other sessions running
  (load average about 2.9 to 4.4).
- **Browser:** headless Chrome 154.0.8037.98, arm64, the project's
  `chrome-devtools-mcp` instance (`.mcp.json`), the page in front.
- **Backend:** `OfflineAudioContext` at 48 kHz, stereo, 128-frame quanta.
  An offline context renders as fast as it can, so a render's wall time is
  the worklets' CPU time on the render thread.
- **Bundles:** the branch's `generated/filter-processor.js` and
  `generated/fm-processor.js`, served from the worktree by the app's Vite dev
  server (`/@fs/…`).
- **Script:** `browserBench.js`, run as
  `bench({ filterUrl, fmUrl, patchUrl, rounds: 7, seconds: 10 })` on the dev
  server's page. Each variant renders 10 s; each round renders every
  variant once, its order rotated, after one warm-up round. Raw records and
  the summary are in `chrome.json`.
- **Scenario:** a looping second of stereo white noise peaking at −6 dBFS
  from an `AudioBufferSourceNode`, so the filter never rests, through one
  `filter-insert` node at Cutoff 1200 Hz, Reso 4, Mix 1. "Source" is the
  noise with no insert, which every insert is read over. "Off" is the
  insert switched off: the node and the copy. The reference is one held
  `pad-drift` voice (`spread` 0, every sustain raised so dormancy never
  engages) through the FM worklet at the same Cutoff and Reso, its voice
  filter Off and Acid.

## Results

ns per stereo frame, median of seven rounds [min–max], and the median per
round over the variant's baseline (an insert over Source, the Acid voice over
the Off voice):

| variant | ns / frame | over baseline |
|---|---|---|
| Source (no insert) | 5.42 [5.42–6.04] | |
| Insert Off | 38.33 [37.92–62.08] | +32.92 |
| LP 12 dB | 55.83 [54.37–58.75] | +50.42 |
| LP 24 dB | 57.29 [57.08–62.71] | +51.87 |
| HP 12 dB | 55.00 [54.58–60.42] | +49.37 |
| BP 12 dB | 55.00 [53.96–58.54] | +49.58 |
| Notch 12 dB | 55.00 [54.38–56.46] | +49.58 |
| **Acid** | **779.58** [766.04–801.87] | **+774.17** |
| Voice, filter Off | 111.87 [103.13–128.96] | |
| Voice, Acid | 477.92 [471.25–488.96] | +362.08 |

- **The node.** An insert that is switched off costs about 33 ns a frame
  over the bare source: a worklet node's quantum and the copy. Every mode
  pays it.
- **The SVF modes** cost about 17 ns a frame over Off, both channels, and
  the 24 dB slope's second section about 1.5 ns more. With the node, an SVF
  Filter is about 50 ns a frame, 0.25 % of a core at 48 kHz.
- **Acid** costs 774 ns a frame over the source: two ladders, one a
  channel, at about 370 ns a channel-sample over the node. One Acid voice's
  ladder costs 362 ns a voice-sample over the same voice with its filter
  Off, so the insert's Acid is two Acid voices' ladders, as the shared code
  says it should be. At 48 kHz an Acid Filter is about 3.7 % of a core.
  The solver's cost does not depend on the signal (a fixed three Newton
  steps at 2×), so a quieter input or a lower cutoff costs the same.
- **Rest.** The insert stops running its filters once its input is silent
  and every state it uses is quiet; this bench keeps it awake on purpose.
