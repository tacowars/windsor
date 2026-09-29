# What the output stage costs (windsor#93)

The engine's safety output stopped being the browser's
`DynamicsCompressorNode` and became Windsor's own output stage worklet
(`worklet/outputStage/`, DSP in `mixer/outputStageLimiter.ts`,
`outputStageClipper.ts` and `outputStageDsp.ts`). Decision 13 of the issue
asks for the CPU cost of each mode, measured. This note is that measurement.

## Where and how

- **Machine:** Apple M1 (8 cores), macOS 26.5.1.
- **Browser:** headless Chrome 154 (`HeadlessChrome/154.0.0.0`), the
  project's `chrome-devtools-mcp` 1.10.1 instance (`.mcp.json`).
- **Backend:** `OfflineAudioContext` at 48 kHz, stereo, 128-frame render
  quanta. The worklet is the generated
  `worklet/generated/output-stage-processor.js` at commit `a6da786` plus
  this branch's changes, served by the Vite dev server.
- **Script:** `bench.js`, run as one `evaluate_script` on a page of the dev
  server with the worklet's `/@fs/…` URL. Raw numbers: `chrome.json`.

Each render is 30 s of a stereo three-tone program under a slow envelope,
from an `AudioBufferSource`, through one of:

- `direct`: straight to the destination, the baseline;
- `compressor`: the old safety limiter, a `DynamicsCompressorNode` at the
  settings `fmEngine.ts` used (threshold −6 dB, knee 0, ratio 20, attack
  3 ms, release 150 ms);
- the output stage in each mode, at its default −1 dBFS ceiling.

An offline context renders as fast as it can, so a render's wall time is the
graph's CPU time on the render thread. Each kind was rendered seven times,
interleaved with the others, after one warm-up render; the table gives the
median, less the direct render's median, per second of audio. The program
was rendered twice: quiet (peak 0.25, −12 dBFS, under the ceiling and the
soft clip's knee) and hot (peak 2, +6 dBFS, 7 dB over the ceiling).

## Results

Milliseconds of render-thread time per second of audio, over the direct
render (median of 7; the spread of the seven runs is within about ±5 %,
see `chrome.json`):

| Path | Quiet (−12 dBFS) | Hot (+6 dBFS) | Output peak, hot |
|---|---|---|---|
| `DynamicsCompressorNode` (the old limiter) | 1.77 | 2.06 | 0.895 |
| Output stage, `off` | 1.17 | 1.18 | 1.99 |
| Output stage, `limiter` | 1.45 | 1.53 | 0.891 |
| Output stage, `limiter` with lookahead | 1.95 | 2.18 | 0.891 |
| Output stage, `soft` | 3.06 | 4.40 | 0.792 |
| Output stage, `hard` | 3.02 | 3.91 | 0.891 |

Read as a share of one core in real time, the dearest mode (`soft`, hot) is
about 0.44 %; the default (`limiter`) about 0.15 %, less than the node it
replaces.

What the numbers say:

- `off` costs about 1.2 ms a second on its own: that is what any worklet node
  costs in this backend (the copy across to the audio worklet scope and the
  call), with the stage's peak measurement on top. The other modes' DSP is
  what they cost beyond it.
- The limiter without lookahead is about 0.3 ms a second more than `off`;
  lookahead adds about 0.5 ms more (the delay line, the sliding minimum and
  the moving average run every frame).
- The clippers run the half-band upsampler on every frame, which is most of
  their cost when nothing clips (about 1.9 ms a second over `off`). When
  they do clip, the decimator runs too: another 0.5 to 1.3 ms a second.
- The hot soft clip's peak (0.792) sits under the ceiling (0.891) on purpose:
  the curve approaches the ceiling without reaching it, and at 7 dB over it
  has reached 0.78 of the way from its knee to the ceiling.

## Limits

These are offline renders, not a live `AudioContext`: they say what the DSP
costs, not whether a given machine drops out. One machine, one browser. The
Node harness is not a cost measurement and nothing here was measured in it.
