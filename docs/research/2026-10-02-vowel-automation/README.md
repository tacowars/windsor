# The Formant vowel on a song lane: what a moving vowel costs

windsor#406 lets a part's song lane move the Formant filter's vowel on
every ringing voice (`voice.filter.vowel`). The voice's vowel is now its
live value, the patch's plus the lane's offset, and `updateVoiceFormant`
keeps its per-section caching: a held vowel does no transcendental work a
block, and a moving one retunes at most the three sections when the value
changes. This folder holds the bench the ticket asks for (decision 7) and
a song to hear the lane on. Nothing here is shipping code.

Measured on an Apple M1 (8 cores, macOS 26.5.1), Node 24.21.0, in the FM
worklet bundle under Node, not in a browser. The "before" bundle is
`origin/main` at `3173b5c`. Other sessions were running on the machine
(load average 4.7 to 5.8), and run 1 overlapped this branch's typecheck and
lint, so both runs are given.

## The bench (decision 7)

`bench.mjs` is windsor#331's bench (`../2026-10-02-formant-filter/bench.mjs`)
with a lane: eight held voices of `pad-drift` (spread 0, every sustain at
0.6 or more), the Formant filter at vowel 0 with the envelope amount at 0,
so nothing but the lane moves the peaks. It renders 5 s, 40 rounds after
two warm-up rounds, the variants interleaved and their order rotated each
round.

- **formant held**: no slot mapped, the patch's vowel.
- **formant lane held**: slot 0 mapped to `filter.vowel` and held at 1.5.
- **formant lane moving**: slot 0 ramping 0 → 4 over one bar (2 s, 120 bpm)
  as a sawtooth, written each 128-sample block as the k-rate parameter
  carries it, so the vowel moves every block of the render.

```bash
mkdir -p <before>/packages/engine/src/worklet/generated
git show origin/main:packages/engine/src/worklet/generated/fm-processor.js \
  > <before>/packages/engine/src/worklet/generated/fm-processor.js
node bench.mjs <repo> <before>
```

| ns per voice-sample | run 1 | filter alone | run 2 | filter alone |
|---|---|---|---|---|
| before, Off | 38.36 | | 36.42 | |
| before, Formant held | 48.29 | +9.61 [8.93, 11.70] | 45.54 | +9.23 [8.76, 9.73] |
| engine, Off | 37.96 | | 36.24 | |
| engine, Formant held | 48.04 | +10.08 [9.20, 11.05] | 45.25 | +9.30 [8.57, 10.24] |
| engine, Formant lane held | 47.79 | +9.89 [8.80, 11.59] | 45.48 | +9.44 [9.04, 9.97] |
| engine, **Formant lane moving** | 48.25 | **+10.38** [9.49, 11.81] | 46.54 | **+9.97** [9.48, 10.95] |

- **Moving against held:** the whole voice costs **1.004× and 1.029×** the
  held vowel's; the filter alone **1.03× and 1.07×**, about 0.3 to 0.7 ns
  per voice-sample, inside the held variants' interquartile ranges. A new
  lane value retunes the three sections (three `Math.tan` and three
  `Math.pow`) at most once per 128-sample block, since the k-rate value
  holds for the block and a control block that finds a section tuned to
  its inputs skips it.
- **A part without a lane is unchanged:** Formant held reads the same on
  both bundles within the runs' spread, as the bit-identical renders
  (`synth/fmProcessorAutomationVowel.test.ts`, the golden) predict.
- **A held lane costs nothing over the patch's vowel:** a mapped slot with
  a constant offset reads with the unmapped held variant.

## Hearing it

`audition/vowel-lane.song.json` is windsor#331's audition song
(`../2026-10-02-formant-filter/audition/formant-audition.song.json`) with
one change: the Choir part (`formant-choir`, patch vowel 3, "o") carries a
Vowel lane that holds "a" to bar 3, where the choir enters, and walks
a → o by bar 6 and on to u at the end. Import it on the Settings tab, play
it, and unfold the Choir part on the Song tab to see the lane and its
readout; the Parts tab's Vowel knob for the Choir shows the lock.
