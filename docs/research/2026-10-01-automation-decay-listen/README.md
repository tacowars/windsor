# Decay lanes on ringing voices: the listen

windsor#347 lets a song's automation lanes move nine voice targets on notes
that are already sounding: the filter's envelope decay, and each operator's
envelope decay and decay curve. The rules (record
`docs/log/2026-10-01-song-automation-lanes.md`, decision 7):

- **A new decay time takes effect from the current level.** The running decay
  keeps its phase, and the rest of it runs at the new rate.
- **A new decay curve reshapes what is left of the decay.** The rest starts
  again from the current level, under the new curve, over the time it had
  left.
- **In neither case does the level jump.** A change during the attack is
  picked up when the decay starts. A change during the sustain or the
  release leaves that note alone, and the next note uses the new value.

These eight renders are for tacowars's listen. Nothing here is shipping
code.

## Playing them

Each file is 6 seconds, mono, 16-bit, 48 kHz, 576 KB. On the Mac, from the
repository root:

```bash
cd docs/research/2026-10-01-automation-decay-listen
for f in pad-*.wav bass-*.wav; do echo "$f"; afplay "$f"; done   # all eight, in order
open pad-plain.wav pad-decay-square.wav                          # or any pair, in QuickTime
```

On GitHub, open a file in the PR's "Files changed" tab and use "View raw" to
download it.

Listen to each `*-plain.wav` first: it is the same music with no lane.
Every render of one instrument has the same gain, so a level change you hear
is the lane's doing.

## The files

At 120 BPM a sixteenth is 125 ms. Every lane below is fed as the browser
feeds it: each lane is mapped to a slot, and each slot's value is read once
per 128-frame quantum (2.7 ms).

**The held pad.** This is `pad-drift` with its attacks shortened to 0.3 s,
every decay at 4 s and the carriers' sustain at 0.2, so a four-second decay
runs under the whole chord. The filter's envelope decays to 0 over the same
4 s, so the filter closes as the chord fades. A C minor seventh (C3 G3 B♭3
E♭4) is held for 5.5 s.

| File | The lane | What to listen for |
|---|---|---|
| `pad-plain.wav` | none | The reference. The chord swells, then fades for four seconds as the filter closes. |
| `pad-decay-sweep.wav` | The five decay times (the filter's and all four operators'), swept from the patch's 4 s down to 0.5 s at the 3 s mark and back up, even in log time. | The fade speeds up toward the middle, then eases off. It should sound like one continuous fade that changes speed, with no step, zipper or tick anywhere. |
| `pad-decay-square.wav` | The same five decay times, switched each sixteenth between 4 s and 0.25 s, each edge a 4 ms ramp. | The fade drops in sixteenth-note stairs, a rhythmic stutter in both the level and the filter. Each stair should be a change of slope, soft, with no click at the edges. |
| `pad-curve-square.wav` | The four operators' decay curves, switched each sixteenth between −1 (fast first) and +1 (slow first). | The fade's shape is redrawn from where it is, each sixteenth. You should hear a gentle pulse in the fade, never a jump or a tick. This is beyond the issue's brief: the curve is the riskier of the two rules. |

**The plucked bass.** This is `bass-digital` as it ships, on a C minor line
of sixteenth notes, each held for 90% of its step.

| File | The lane | What to listen for |
|---|---|---|
| `bass-plain.wav` | none | The reference. |
| `bass-decay-sweep.wav` | The five decay times, swept from the patch's own down to an eighth of it at the 3 s mark and back. | The plucks tighten toward the middle and open again. Most changes land inside notes that are still ringing. There should be no click as they do. |
| `bass-decay-square.wav` | The five decay times, switched each sixteenth between the patch's own and a sixteenth of it, 4 ms edges. The square starts a thirty-second late, so every edge falls in the middle of a note. | Every note has its decay changed halfway through, alternating: one note is cut short mid-note, the next is let go long mid-note. You should hear a tight-loose alternation and no tick at the mid-note edges. |
| `bass-curve-square.wav` | The four operators' decay curves, switched between −1 and +1 each sixteenth, a thirty-second late. | Each note's tail is reshaped halfway through, which is subtler than the time square. There should be no tick. This one is also beyond the brief. |

## The click measure

`render.mjs` prints each render's largest sample-to-sample step after its
gain. This is the measure `__fixtures__/voiceClicks.ts` uses. A click would
show as a step above the plain render's. None does: the largest step in
each is the waveform's own.

| Render | Largest step |
|---|---|
| `pad-plain` | 0.2800 |
| `pad-decay-sweep` | 0.2796 |
| `pad-decay-square` | 0.2590 |
| `pad-curve-square` | 0.2440 |
| `bass-plain` | 0.3516 |
| `bass-decay-sweep` | 0.2867 |
| `bass-decay-square` | 0.2499 |
| `bass-curve-square` | 0.2495 |

The tests hold the same thing more strictly:
- `synth/fmProcessorAutomationDecay.test.ts` puts windsor#7's line under a
  sixteenth-note square on each of the nine targets.
- `synth/fmProcessorAutomationDecayEdge.test.ts` checks the level at the
  change itself, at both ends of the register.

The step measure alone does not catch a level jump: each control block's
amplitude ramp spreads a jump over 32 samples. The edge test is the guard
for that.

## Regenerating

```bash
node docs/research/2026-10-01-automation-decay-listen/render.mjs             # writes the WAVs here
node docs/research/2026-10-01-automation-decay-listen/render.mjs --out /tmp/x  # or elsewhere
```

It renders through the shipped bundle,
`packages/engine/src/worklet/generated/fm-processor.js`, so rebuild that first
(`node scripts/build-worklets.mjs`) after any change under `worklet/fm/`. The
render is seeded and repeats bit for bit on one machine. These files were
rendered on an Apple M1, under Node 24.21.0, from the PR's branch. V8's
`Math.pow` and `Math.exp` can differ by an ulp between arm64 and x64, so
another machine may differ in the last bit.
