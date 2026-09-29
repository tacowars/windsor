# A Tape insert adapted from REELS Lite

The user's brief is an insert based on the local REELS Lite Max for Live
device. Add `tape` to the existing insert registry, available on both tracks
and the song master. The engine owns the graph and DSP; the console only
writes song settings. This is a reviewed sound/UI change. Listening approval
remains with tacowars.

## Source and licence

REELS is by Tom Glendinning / ELPHNT. The supplied Getting Started Guide
points to <https://elphnt.io/licensing/>. Checked on 2026-09-30, that page
licenses all ELPHNT content under CC0 and explicitly permits modification
and distribution. Its linked licence is
<https://creativecommons.org/publicdomain/zero/1.0/>.

Inspected sources:

- `Documents/Max 9/Max for Live Devices/REELS Lite Project/tape_core.gendsp`:
  saturation polynomial, drive bounds, smoothing and makeup exponent.
- `Downloads/REELS Lite/REELS Lite.amxd`: embedded patcher, including
  `p bias`, `p models` / `coll tape_models`, `p wow_and_flutter`,
  `p dropouts`, `p hiss` / `coll hiss_offsets`, and the Lite control ranges.
- `reels_random.js`: bounded, weighted randomization, preserving output trim.
- `REELS Getting Started Guide.pdf`: control meanings and Lite/full scope.

The source device, PDF, branding and `tape_heads.js` drawing are not bundled.
The port's constants and DSP identify their provenance. Windsor's code
remains AGPL-3.0; the adapted source is CC0-compatible.

## Sound and saved settings

The chain is Bias EQ → tape-model EQ → drive → saturation and makeup → DC
block → variable delay → add hiss → dropouts → output trim. Mix blends with
undelayed input; at Wear > 0 a partial mix can deliberately produce combing.
With Wear = 0 the delay reads the current sample. Bypass and Mix = 0 preserve
the original stereo samples (live changes use a 10 ms smoothing time constant).

The three Lite models are 30ips Studio, Ferric and Vintage. Their EQ rows
and hiss offsets (-4, +2 and +3 dB) come from the embedded patcher. No
full-version model is invented. Positive Bias brightens; negative Bias
darkens, with the source's opposite shelves at 300 and 600 Hz. Model paths
stay warm and crossfade to avoid changing a filter's topology mid-signal.

Drive uses the supplied `tanh` curve plus second- and third-order terms
(0.1 and 0.8), with 0.7-power makeup for positive drive and inverse gain for
negative drive. Negative drive approaches linear response; it is not exact
transparency because EQ and the residual curve still act. This is not an
oversampled saturation model and makes no alias-free claim.

Wear combines slow random drift, faster random flutter and random level
loss. The modulation is shared between channels, preserving stereo
relationships. Hiss is mono, filtered and colored by the selected model,
added after the variable delay and before dropouts. The minimum Hiss value
(-70 dB) means off, matching the source gate. Hiss defaults off. Trim applies
to the wet path; bypass and the dry portion are not trimmed.

Randomize changes the type, Drive, Bias, Wear and Hiss with the source's
weighting, and also rolls a saved noise seed. It preserves Trim, Mix and
enabled. The seed is an integer up to 2^24 - 1 so the worklet's Float32
AudioParam carries it exactly. A newly instantiated processor reproduces
its stream from the saved seed. Live edits do not rewind delay/filter state.

## Deliberate adaptations

This is an adaptation, not a bit-identical Max emulator. RBJ biquads use
the source frequencies/gains and Q as damping; Max's `filtergraph~`
coefficient semantics are not asserted equivalent. The DC block has a
sample-rate-independent 10 Hz pole. Random targets are smoothed one-pole
signals, and dropouts use a smooth random-length envelope instead of Max's
`rand~`, `rampsmooth~`, `adsr~` and control scheduler. Hiss uses a fixed
300 Hz high-pass / 9 kHz low-pass approximation followed by model EQ; the
source's moving noise EQ and separate click/pop generator are not ported.
All randomness in audio is seeded mulberry32, with preallocated state and
sample counters; there is no clock or unseeded random source in DSP. The
existing opt-in processor load telemetry uses wall time, like other inserts.

REELS Lite's optional Hiss < Playback switch is not included. Enabled hiss
runs continuously while the audio context runs, matching REELS' default.
A transport-aware switch would need a separate engine transport/insert
contract; signal detection would incorrectly cut intentional silent passages
and MIDI audition. The full device's link groups are also outside this
Lite-based insert. No tape animation is added.

All settings are song-owned and normalized on track/master inserts. No
format bump: old songs have no Tape insert and retain their behavior. No
existing patch, preset index or DSP golden is changed. A new worklet bundle
is generated and loaded with the other engine modules.

## Verification and audition

`tapeDsp.test.ts` renders the shipped bundle for finite control extremes,
44.1/48/96 kHz, dry/bypass equality, mono input, stereo isolation, seed
repeatability, silent input, hiss off/on, wear, tone direction and shutdown. `tapeMusical.test.ts` covers articulated saw
bass and a six-second pad chord through the real synth and Tape processors.
`tapeSpec.test.ts` checks junk normalization, full song round trips with
track and master inserts, and randomization bounds/preserved controls.
`tapeInsert.test.ts` checks live parameter updates without rewiring,
output-edge ownership, load-meter attachment and disposal. The console table
test pins its ranges/defaults; the registry test requires a card and label.

Audition in Mixer → Add insert → Tape. Start with 30ips Studio, Drive 0,
Bias 0, Wear 0, Hiss Off, Trim 0 and Mix 1. On a held pad chord, raise Wear
slowly to 20–40; on a bass or drum part, compare Drive 0 and +12. Compare
Ferric/Vintage against Studio, and Bias -30/+30. Try Hiss -50 only after the
musical balance is set. Randomize keeps Trim/Mix/bypass but may change
perceived level. Use the song master meter and compare with bypass. Musical
approval and matching against a real Max render remain listening work, not
a conclusion of numerical tests.

Local verification on 2026-09-30: all 3,636 tests (268 files), typecheck,
worklet/index freshness and production build pass. Lint passes with the
unrelated `.claude/worktrees/**` checkout excluded; formatting passes over
Git-tracked/nonignored task files. Unmodified broad lint scans that nested
checkout and cannot resolve a unique TypeScript config root.

An isolated headless Chrome 154.0.8037.58 check confirmed track/master Tape
menus, all six knobs, model selection, bypass, Randomize preserving
Trim/Mix/bypass, clean card layout, audio startup and advancing transport
without captured runtime/log errors. Reload/Restore preserved both inserts
and their displayed values. This did not establish a listening verdict;
file export/import is covered by the song round-trip tests above.
