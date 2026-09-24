# Phaser insert — #687

An original, adjustable classic phaser for acid basslines and spacey pads.
Decision: `2026-09-24-687-creative-classic-phaser`. Listening verdict pending.

## Sources and implementation choices

- [Stone Phaser](https://github.com/jpcima/stone-phaser), local checkout
  `/Users/arrakis/code/stone-phaser`, revision
  `f057ea5c1e368d6cd937f4e359a9514ac72fe902`. Read README, both Faust DSP
  entries and LICENSE. Its four all-pass stages, logarithmic sweep, feedback
  bass cut and stereo phase offset informed the design. Its DSP declares
  CC0-1.0 or BSL-1.0; the root license is Boost 1.0. We ship original TS DSP,
  not its generated C++, source, artwork or Faust dependencies.
- [EHX Small Stone manual](https://www.ehx.com/wp-content/uploads/2021/07/small-stone-manual.pdf):
  the Rate and Color controls establish the broad musical reference. No
  measured device comparison was performed; Deep color is our own setting.
- [Kiiski, Esqueda and Välimäki, DAFx 2016](https://dafx.de/paper-archive/2016/dafxpapers/05-DAFx-16_paper_42-PN.pdf):
  phasing as dry plus cascaded time-varying all-passes, with measurement-based
  modeling as a separate fidelity task. We have not fitted the paper's model.

Four identical first-order stages give two notches at half wet. The digital
corner uses a bilinear transform; normalized lattice state stays passive
under coefficient changes. A cosine LFO sweeps logarithmically, unlike
Stone's rounded triangle. Each channel has independent filter/feedback
state and a shared, linked envelope. Input is never folded to mono.

Feedback has a one-sample delay, a one-pole high-pass and gentle tanh
saturation. No oversampling or transistor/OTA/converter model is claimed.
High feedback can increase level; use track/Master level or the compressor
when shaping aggressive settings. Bass keep preserves the low band, not
an exact brick-wall frequency range. Controls are free-running, with no
tempo sync or note-trigger reset.

## Controls

| Control | Meaning |
|---|---|
| Rate | 0.01–8 Hz; free-running LFO |
| Center | 80–4000 Hz; geometric center of the sweep |
| Depth | 0–4 octaves on either side of center; 0 freezes the LFO's frequency contribution |
| Feedback | −0.9…0.9; opposite polarities emphasize different resonances |
| FB bass cut | 20–2000 Hz; cuts low frequencies from the feedback path |
| Stereo | 0–180° offset of the right LFO; 0 keeps mono input centered |
| Envelope | −4…4 octaves at full detector level; follows accents and note articulation |
| Bass keep | 0–1 amount of the 150 Hz low band routed around phasing |
| Mix | 0 dry, 0.5 classic cancellation, 1 phase-shifted wet |

The corner is clamped to 20 Hz…0.2 × host sample rate. All numeric controls
and bypass are smoothed. Bypass continues processing history. Presets write
all sound values but preserve Mix/enabled; no preset ID is saved in songs.

## Audition in the standalone editor

Open this worktree's `tools/patch-editor/patch-editor.html` in Chrome, press
Enable audio, then import your `acid.json`. Existing inserts are preserved.
In Mixer, add **Phaser** to the acid track, choose **Acid motion**, start with
Mix 0.5. Compare bypass while the pattern runs, turn Envelope towards zero
to hear what the follower contributes, then vary Feedback and Bass keep.
For pads, add Phaser to the pads track, select **Space pad**, hold a chord
for at least 15–20 seconds and compare Stereo 0/120°. Try Hollow orbit for
opposite-polarity resonances. Avoid adding it to Master simultaneously for
this initial comparison. No edits to the original arrangement are required;
export a new song to retain your choices.

The retained `audition-song.json` is a small browser persistence fixture
using Init, not a replacement for your arrangement. `editor.png` records
the live track and Master controls. The test suite also feeds the shipped
Saw Arp bass and Drift Pad chord through the generated insert with track
level 0.5 for headroom (the tested three-note pad exceeds unity even dry).

## Verification and measurement

`phaserDsp.test.ts` checks the analytical two-notch response and wet all-pass
magnitude at 44.1/48/96 kHz, moving sweep, stereo offset, envelope, signed
feedback, bass preservation, extreme edits, decay, bypass history and load
messages. Insert/song tests cover fixed graph lifetime, meter accounts,
normalization, editable presets and track/Master JSON round trips.

`collect.mjs` exercises the generated file page in Chrome: audio enabled,
live track/Master preset changes, a real knob drag becoming Custom, export,
re-import and exact exported-document equality, plus OfflineAudioContext
renders. `browser.json`, `console.json` and `network.json` retain results;
zero console errors/warnings. This is functional evidence, not a listening
verdict or a game rendering benchmark.

`bench.mjs` measures complete shipped callbacks, 48 kHz / 128 frames,
one warmup second and three timed seconds per case. Apple M1, Darwin 25.5.0,
Node 24.20.0 / V8 13.6: median one-instance results were 17.38–18.21 ms per
audio second; eight instances 139.35–150.60 ms. See `throughput.json` for all
samples. These are sequential offline timings, not browser deadlines,
dropouts or target-machine guarantees. The earlier dynamic-key smoothing
loop is retained in `throughput-before-smoothing-optimization.json`;
explicit named-field smoothing reduced this measured overhead.

Reproduce from the worktree with Node 24:

```sh
node scripts/build-worklets.mjs
node tools/patch-editor/build-editor.mjs
node docs/research/2026-09-24-687-phaser/bench.mjs
node docs/research/2026-09-24-687-phaser/collect.mjs
```

Production entry: 729524 → 730811 bytes (1287 byte increase), plus the 6866-byte separate worklet. `build-size.json` uses a clean detached baseline so unrelated untracked songs do not skew the comparison.
