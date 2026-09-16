# Audio Architecture — Synthesised Runtime Audio

**Status:** Accepted (2026-08-31). Implemented by #33.
**Purpose:** Record how runtime audio works. The functional requirements it serves are in
[game-design-document.md](game-design-document.md) §5.3 and §5.4.

---

## 1. Standing

`CLAUDE.md` invariant 4 originally read *"No time goes into art, animation, or audio
during the tech demo"*, following design doc §1. **Audio is now excepted from it**, by
maintainer decision `docs/log/2026-08-31-audio-enters-tech-demo-scope.md`. The invariant
text was amended in the same PR, so the repo does not contradict itself; art and
animation are unchanged, and design doc §1's governing rule is untouched.

The reasoning is recorded in that decision, but the short form matters here: **a
synthesiser is not an asset.** Invariant 4 guards the asset pipeline — imported files,
licence tracking, bundle weight, art time. Synthesised audio imports nothing, adds no
entry to `packages/client/assets/LICENSES.md`, and verifies like any other code.

What is *not* in scope: wiring audio to gameplay events. #33 landed the engine and proved
it works. Making the game make noise is separate work, constrained in advance by §4.

## 2. Why synthesis rather than sampled audio

Settled history, kept short. Three GDD requirements make samples the wrong default:
§5.3's DRG-style telegraph (ambient drop-out → rumble → horn, and *"the AI goes quiet
mid-sentence"*) is a continuous parameterised transition rather than a clip; §5.3's
*"distinct audio per enemy type"* wants one patch family with per-enemy parameter offsets,
so kinship is audible by construction instead of drifting file by file; and §3.3's AI
character wants a persistent voice without shipping the largest asset class in a browser
build. Two browser-specific arguments seal it: the whole engine plus its patch set is under
100 KB against megabytes for a modest sampled set (invariant 5), and the client already
runs under `Cross-Origin-Embedder-Policy: require-corp` for Havok, which makes a
CDN-hosted audio asset a live problem and a generated waveform a non-problem.

The counter-argument is honest and should be recorded: **synthesised audio has a
ceiling.** It will not produce a convincing recorded voice or a naturalistic
environmental bed. If the game later wants either, that is a sampled layer alongside
this one, not a replacement for it.

---

## 3. The engine

Four-operator FM, chosen over the alternatives for a specific reason: it is the cheapest
synthesis architecture that still produces *characterful* sound across the whole range
the game needs — bells, drones, stabs, noise-based impacts and voice-like formants —
from one code path and one patch format.

| | |
|---|---|
| Operators | 4 per voice, 11 algorithms, per-operator bipolar feedback (+ towards sawtooth, − towards square; #529). A modulator at full Level, envelope open, shifts the phase it feeds by 4 cycles ≈ 25 rad (#543) |
| Waveforms | Sine, saw, square, triangle, noise; unbandlimited "digital" saw/square; 4-bit and 8-bit sine; user-defined harmonics |
| Envelopes | Per operator, plus filter and pitch: Init/Attack/Peak/Decay/Sustain/Release/End, per-segment curve, key scaling, three loop modes |
| Filter | Per-voice state-variable (TPT): LP/HP/BP/notch, 12 or 24 dB, resonance, drive, envelope, LFO, key tracking |
| Modulation | Per-voice LFO (7 shapes) to pitch, filter and any operator; pitch envelope; glide; unison spread; mono voicing (one note at a time, with retrigger) |

**Not** a chip emulation. The OPL/OPM register interface, the fixed voice count, the
fixed sample rate and the single hard-panned output bus are all absent by choice: the
last of those makes per-voice routing impossible, which is precisely what a 3D game
needs. Waveforms are built from harmonic partials into per-octave bandlimited tables,
which is what makes saw and square usable as FM operators at all.

### Division of labour

**Two worklets are ours; everything else is native Web Audio nodes**, which execute in the
browser's own audio thread and cost nothing from the JS main-thread budget that
[tech-demo-proposal.md](tech-demo-proposal.md) §1 identifies as the project's primary
risk. This section first said "only the FM runs in the AudioWorklet";
`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` decision 4 removed the `ConvolverNode`
path outright — `generateImpulseResponse` and the convolver are gone — and put the reverb
in a second worklet of its own:

| Concern | Where |
|---|---|
| FM voices, per-voice filter, envelopes, LFO | AudioWorklet (ours): `worklet/fm-processor.js` |
| Reverb | AudioWorklet (ours): `worklet/reverb-processor.js`, a Dattorro plate. **No `ConvolverNode`** — it was removed, not left beside it |
| Bus tone shaping, delay, distortion, compression | `BiquadFilterNode`, `DelayNode`, `WaveShaperNode`, `DynamicsCompressorNode` |
| 3D positioning | Babylon's spatial audio, over `PannerNode` |

**One worklet node per timbral *part*, never per voice.** Each node carries fixed
overhead; 8–16 internally-polyphonic parts is the shape, each with its own native effect
chain.

**One-shot world SFX are baked, not synthesised live.** A dozen turrets each needing an
independent 3D position do not need a dozen worklets: render the patch once through an
`OfflineAudioContext` at load, then play ordinary spatialised buffer sources. Live
synthesis is for music, ambience, and anything whose parameters move.

---

## 4. Placement in this repo

Audio is **client-only**. `CLAUDE.md` invariant 1 requires `packages/shared` to be
deterministic and free of Babylon, DOM and Node APIs; Web Audio is a DOM API and audio
output is not part of the simulation. Nothing audio-related may enter `shared`.

```
packages/client/src/audio/
  audioSystem.ts        # the system: update(dt), owned by the render loop
  fmEngine.ts           # context, worklet module, parts, buses
  audioPart.ts          # one timbral part == one worklet node
  audioBus.ts           # dry buses with inserts (native nodes)
  mix.ts                # the desk: RETURNS and the SFX strips (MIX), typed plain data
  returnBus.ts          # sends and returns: the plate and the delay, 100% wet
  channelStrip.ts       # one part through its strip: fader, rotation, sends
  stereoRotate.ts       # the pan matrix (splitter -> 4 gains -> merger)
  scheduler.ts          # look-ahead note scheduling
  offlineRender.ts      # bake a patch to an AudioBuffer
  babylonBridge.ts      # the Babylon Audio Engine v2 seam
  patch.ts              # schema, enums, algorithm routing table
  patchLibrary.ts       # the patches/*.json file contract and validator (#561)
  patches/              # the patch library: one <id>.json per patch, plus a generated index.ts
  presets.ts            # the whole-bank table (PRESETS, PATCH_LIBRARY) — editor/test only (#562)
  gameplayPatches.ts    # GAMEPLAY_PATCH_IDS: the patches game code plays, imported by id
  presetCatalog.ts      # listing and filtering of the library's metadata
  arrangement.ts        # the song's part list: slot, name, preset, sequencer kind (#597)
  arrangementDocument.ts # makeArrangement: the never-throws version-2 normaliser
  arrangementPlayer.ts  # binds each part's sequencer to its engine part, by slot
  arrangementValidate.ts # PatchResolver: where a song's part presets resolve (#562)
  workletMessages.ts    # main-thread <-> worklet contract
  worklet/              # the DSP (§6.1)
  __fixtures__/         # headless worklet harness, Node-only
tools/patch-editor/     # authoring tool, outside the client bundle
```

This follows the `area:*` mirroring rule in `CLAUDE.md` — an `area:audio` ticket points at
one directory — and the systems rule: an explicit `update(dt)` owned by the loop, never
logic inlined in `runRenderLoop`.

**A song is a list of parts, each with any sequencer** (#597, record
`2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind`). An
`arrangements/<name>.json` is `version: 2` with 1–8 `parts`; each part sits on a unique
`slot` 0–7, carries its own `strip` (level, pan, sends) and a `sequencer` whose `kind` is
`euclidean` (a fixed-note trigger), `arp`, `step` (slow with gate 1, the drone) or `none`
(inert: built and playable from the keyboard, never sequenced). The slot is the part's
identity — its engine part is `music-<slot>`, its generator stream is seeded by the slot —
so removing, reordering or renaming a part never moves another part's notes; the name is a
label. Live partials address parts by slot (`{ parts: { 2: { velocity: 0.5 } } }`); adding
or removing a part rebuilds. The earlier four fixed slots (`kick`, `hat`, `arp`, `drone`)
and the top-level `mix` overlay are no longer read.

**A song document is self-contained, and the game resolves patches from it alone**
(#562, epic #564 decision 2). An `arrangements/<name>.json` carries a snapshot of every
patch its parts play in its `patches` section; `PatchResolver` (`arrangementValidate.ts`)
is the one resolver, and on the game path it is handed the document's patches and nothing
else — a name it cannot resolve is a load error naming the part and the id, never a fall
back to the library. So improving a `patches/<id>.json` cannot change what a shipped song
sounds like, and no game path imports the whole-bank table: the bundler drops the library
(#562 cut the client chunk by 245 KB). Two deliberate exceptions, both by id and both
bundled: `gameplayPatches.ts` for the game's own sounds, which are not songs, and the
metronome fallback, which carries its one patch the same way every other document does.

The editor is the only caller that relaxes the rule, through `makeArrangement`'s one
`libraryFill` option: a document written before #562 resolves its names from the library
once on open, the resolved patches are embedded into the document there and then, and the
Arrangement tab says which ids were filled. The next export is self-contained.

**Audio observes; it never decides.** Simulation events flow one way — the authoritative
server and the client sim emit events, the audio system subscribes and makes noise. No
audio state may feed back into simulation state, and nothing in the audio path may
influence anything the server also computes. A dropped or late sound must be inaudible to
the simulation, or invariant 1's determinism guarantee is worthless.

---

## 5. Babylon.js integration

Babylon's Audio Engine v2 accepts an externally-created `AudioContext` and can wrap an
arbitrary `AudioNode` as a spatialised sound source. That is the whole seam: the synth
owns the DSP, Babylon owns positioning and bus routing, and there is exactly one
`AudioContext` in the process.

**The seam is built: `packages/client/src/audio/babylonBridge.ts`.** Read it rather than a
sample here — it carries the working code, and its header carries the typings verification
this section used to table (every symbol read from the installed
`node_modules/@babylonjs/core` at 9.23.0, `CLAUDE.md` source of truth 1, cross-checked
against the `BabylonJS/Babylon.js` repository at tag `9.23.0`).

One trap worth recording, because it is not visible from the call site: on the WebAudio
engine *class*, `createSoundSourceAsync` is tagged `@internal` — but so is
`createSoundAsync`, which is unambiguously public API. The public surface is the abstract
declaration on `AudioEngineV2` and the free `CreateSoundSourceAsync` function; the tag is
on the implementation override, not the contract.

Two notes the vendored `babylonjs` skill makes that apply directly:

- Write v2 only. The v1 `Sound` / `AudioEngine` classes are legacy and are one of the
  deprecated idioms the skill warns creeps in from third-party posts.
- Audio engines hold GPU/OS resources and are not garbage-collected — dispose them.

Deep-import per invariant 5: `@babylonjs/core/AudioV2/webAudio`, never the barrel.

---

## 6. Constraints this repo imposes on the implementation

### 6.1 Each worklet is one file, deliberately

There are two: `worklet/fm-processor.js` (1,302 lines) and `worklet/reverb-processor.js`
(460), each far over the `max-lines` cap of 300 and each staying that way behind a
file-top disable with its reasoning. Decision:
`docs/log/2026-08-31-audio-worklet-single-file.md`; the reverb's own
`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` decision 4.

An earlier draft of this document flagged worklet bundling as an unresolved spike that
blocked any audio ticket. **Keeping each file whole is what resolved it.** Because neither
has an `import` statement, `new URL('./worklet/<name>.js', import.meta.url)` resolves
in both the dev server and the production build with no bundler configuration. Splitting
one would reintroduce the problem: Vite's `?url` and `new URL(…, import.meta.url)` yield a
URL for the file itself *without* bundling its dependency graph — fine in dev, broken in
a build — so a split worklet needs a second Rollup input, a `?worker&url` indirection, or
a bespoke build step.

The cost is duplication: the waveform enums and the algorithm routing table exist both in
the worklet and in `patch.ts`. `patch.test.ts` asserts the copies are identical, so they
cannot drift silently. The seeded PRNG the DSP tests use (#78) is the same story: it is
`mulberry32` copied out of `packages/shared/src/terrain/heightmap.ts`, because the worklet
cannot import it. The game path is unchanged — absent `processorOptions.seed` the
processor draws free-running operator phase, per-voice noise seeds and pan jitter from
`Math.random` exactly as before, and a part whose every note started from the same phase
would sound mechanical. Reasoning, and the headroom measurement the seed made possible:
`docs/log/2026-09-02-bass-digital-clip-headroom.md`.

### 6.2 Cross-origin isolation is already on

`packages/client/vite.config.ts` sets COOP/COEP for Havok. Consequences for audio:

- `SharedArrayBuffer` is available, so the Worker + SAB audio pattern is on the table.
  It is almost certainly unnecessary at these costs and adds real complexity; noted so
  the option is known, not recommended.
- `require-corp` blocks cross-origin subresources that do not opt in. Generated audio
  sidesteps this; any future sampled layer must be same-origin or CORP-enabled.

### 6.3 Numbers must be measured

`CLAUDE.md` invariant 3: pass/fail numbers are measured on the target machine, and a
claim without a machine and backend named is not a result. §7 applies this to the one
figure this design currently has.

---

## 7. Performance: what is known, and what is not

**Not a qualifying measurement.** The prototype renders 32 voices of its heaviest preset
in about 10% of one core. That was measured headless in Node 22 on an Apple Silicon Mac,
against wall-clock audio time — not in a browser, not with a render loop competing for
the main thread, and not on the target machine (Ryzen 5 5600G / Vega 7 / Chrome /
Ubuntu). Under invariant 3 it is an indication that the approach is not obviously
infeasible, and nothing more.

What would qualify, when audio is built:

- Audio runs in the browser's audio thread, so the number that matters is not frame rate
  but **dropout**: `AudioContext.baseLatency`, and a count of buffer underruns over a
  fixed window, taken on the target machine with a backend named.
- The main-thread cost of audio is the *scheduling* work, which belongs in `src/stats.ts`
  alongside the existing counters so it appears in the same overlay every other milestone
  reading comes from. It is now there: `stats/lines/audio.ts` draws it and
  `bench/summary.ts`'s `AudioMetrics.schedMs` records it (#275).
- Suggested criterion, to be argued when the ticket is written: **zero underruns over a
  60 s M3-equivalent horde window, with audio scheduling under 0.5 ms of main-thread time
  per frame at p95.**

**What exists now (#445).** Both halves are instrumented, and neither is a
gate yet:

- **In the frame.** `?bench=1&audio=1` builds the `AudioSystem` and plays the
  `?music=<name>` document through the standard window, against the same rung
  in silence: `node scripts/run-bench.mjs --audio[=<name>]`. That is the arm
  the milestone cadence can take a music reading with; the verdict is the
  three standing frame gates, and no audio field votes.
  `docs/reference/client-measurement-seams.md` is the seam.
- **On the audio thread.** `packages/client/src/audio/audioLoad.ts` owns
  `AudioLoadReadout { loadPct, peakPct, underruns, processors }`, exposed on
  `AudioSystem.readout().load` and `__a204.audio.readout()`, drawn as one
  overlay line and carried into the bench JSON's `audio` block. Both worklets
  accumulate it inside `process()` and post once per interval, so the
  "no allocation in `process()`" rule of §6.1 still holds.
- **What the probe found.** The two measurements this section assumes are not
  available in Chrome 152: there is no `AudioContext.renderCapacity` (flagged
  builds included) and no `performance.now()` in `AudioWorkletGlobalScope`, so
  a processor cannot time its own call. The readout is therefore a
  **duty-cycle sampler** built on `Date.now()`, whose resolution (1 ms) is a
  third of a render quantum (2.9 ms at 44.1 kHz): it reads 0 at rest and
  tracks the true load monotonically while over-reading it by roughly 2–3×.
  The record and its calibration are
  `docs/research/2026-09-11-445-audio-bench-arm/`. `underruns` — quanta whose
  measured span reached the whole budget — is the one hard number, which is
  why the suggested criterion above is still expressed in underruns and why
  it is argued at the first target reading rather than asserted here.
**What exists now (#275).** The section's own criterion — "zero underruns over
a 60 s M3-equivalent horde window, with audio scheduling under 0.5 ms of
main-thread time per frame at p95" — is now readable off the instrumentation
rather than estimated. Both halves come from
`packages/client/src/audio/audioCost.ts`'s `AudioCostReadout`, which is what
`stats.audioReadout` hands the overlay and the bench collector:

- **Underruns: `AudioContext.playbackStats`** (`audio/playbackStats.ts`), the
  source of truth for the criterion. Present by default in Chrome 152 on the
  target box, feature-detected everywhere, and reported as `n/a` / `null`
  where it is absent — never replaced by an estimate. The units matter and are
  not the obvious ones: **one `underrunEvents` is one output-device callback
  delivered short**, which on the box is 512 frames at 48 kHz = 10.667 ms =
  exactly `baseLatency`, *not* one 128-frame render quantum;
  `underrunDuration` is in seconds of output, and `totalDuration` is output
  time (it holds while the context is suspended), so
  `underrunDuration / totalDuration` is the glitch fraction of what was
  actually played. The counters are cumulative for the context's life and lag
  their own load by up to three seconds, so the overlay shows lifetime totals
  and the bench reports a **delta** across the window taken after
  `AUDIO_STATS_SETTLE_MS`. They also **saturate**: at 150 % and at 300 % of
  the quantum budget the box read about the same ~90 events/s, so the number
  says whether and for how long audio broke, never by how much. The record is
  `docs/research/2026-09-14-275-playbackstats-probe/`.
- **Scheduling cost: `audio.schedMs`** (`audio/schedCost.ts`), the p95 half of
  the criterion. `AudioSystem.update()` times its own scheduler pump — the
  system's whole per-frame main-thread cost — over a rolling one-second
  window for the overlay, and per frame for the bench, whose `audio.schedMs`
  distribution is what a milestone reading quotes.
- The sampler's own `underruns` stays beside them, **labelled `est`**: it
  counts something else (a render quantum that provably overran) and is the
  conservative lower bound described above, not a second opinion on the same
  number.
- **Still missing:** a target-box reading. The #445 audio pair is the first
  one to carry these fields (#275 decision 8); until it is taken, no number
  here is a result (invariant 3).

Two known costs, recorded so they are not surprises:

- FM sidebands alias regardless of how well the source tables are bandlimited. This is
  inherent to FM and not a defect; a global brightness control is the practical lever, and
  2× oversampling is the escape hatch if a specific patch needs it.
- Building wavetables for an unseen waveform happens on the audio thread when a patch
  loads. The common waveforms are prebuilt at module load and the cache is shared across
  parts, so this only bites on an unusual first load — load the patch set during a
  loading screen.

---

## 8. Decisions still needed

ADR candidates in the sense of `docs/adr/README.md` — each would constrain work across
more than one ticket. None is urgent; record them when the work that needs them is
scheduled.

1. **Whether audio is ever authoritative for anything.** The position here is no (§4).
   Worth an explicit record, because "the horn plays when the wave spawns" invites a
   shortcut where the sound *is* the event.
2. **Whether a sampled layer is ever added** (§2), and if so where it sits relative to
   this one.

Questions from earlier drafts that are now settled and recorded rather than pending:
worklet bundling (§6.1, `2026-08-31-audio-worklet-single-file`), audio's standing
against invariant 4 (§1, `2026-08-31-audio-enters-tech-demo-scope`), and **music
structure** — a sequenced arrangement driven by the scheduler, decided across
`2026-08-31-generative-sequencing-transport-and-pitch` (the 24 PPQ transport and its
fan-out), `2026-08-31-arrangement-document-schema-and-optional-parts` (the arrangement
document, `arrangementDocument.ts` and `arrangements/bed-01.json`),
`2026-08-31-arrangement-console-and-runtime-arrangements` and
`2026-08-31-music-mute-and-suppression-semantics` (mute defined against the transport's
tick).

## 9. Provenance and references

The engine was prototyped outside this repository before #33 and ported wholesale. The
prototype survives as a standalone git snapshot in the sibling `Aotearoa204/` checkout
under `audio/`; it is not a dependency of anything here, and the repository copy is the
one that is maintained.

The patch editor in `tools/patch-editor/` is generated, not hand-maintained. It inlines
the real worklet and the real patch schema, so it cannot drift from what the game runs.
After changing the DSP or the schema:

```sh
node tools/patch-editor/build-editor.mjs
```

All of it is original code; no emulator source was copied. Reference material and its
licence standing:

| Project | Licence | Standing |
|---|---|---|
| [ymfm](https://github.com/aaronsgiles/ymfm) | BSD-3-Clause | The only cleanly permissive OPL/OPM/OPN core. Relevant only if `.VGM` playback is ever wanted |
| [msfa](https://github.com/google/music-synthesizer-for-android) | Apache 2.0 | Best open DX7 engine; correctness reference for envelopes and operator feedback |
| [dx7-synth-js](https://github.com/mmontag/dx7-synth-js) | MIT | Clearest readable JS FM voice; useful for envelope curve shapes |
| [DaisySP](https://github.com/electro-smith/DaisySP) | MIT | Effects, filters, reverb |
| [Airwindows](https://github.com/airwindows/airwindows) | MIT | Effects |
| [Dexed](https://github.com/asb2m10/dexed) | **GPLv3** | Do not read into this codebase |
| [Cardinal](https://github.com/DISTRHO/Cardinal) | **GPLv3+** | Fine to design by ear against; do not port code from it |

The two GPL entries are listed precisely because they are the most tempting references.
Ableton Operator informed the feature set — the waveform range, per-operator envelopes,
the filter section, and an 11-algorithm set rather than the DX7's 32. No code is involved.


## 10. Hybrid gameplay SFX (#489)

The sampled layer anticipated in §2 is adopted by Pat's 2026-09-12 decision:
[hybrid gameplay sound](../log/2026-09-12-hybrid-gameplay-sound.md).
`tools/sfx/README.md` describes ElevenLabs authoring, provenance, spend and
auditioning. This supersedes §8's open question about adopting samples.

`createGameplaySfx.ts` shares the music context, loads sampled footsteps and
impacts, and bakes `weapon-zap` through `offlineRender.ts`. `SpatialSfx` owns
independent spatial playback slots and bounded voices; `GameplaySfx` observes
movement and confirmed hits through the frame registry. The `sfx` console
command controls its volume independently of music. Credentials are authoring
only. The listener uses character position and camera orientation.

First-delivery limitations: one earth/grass step bank for all surfaces, metal
impact candidates, distance-derived contact timing and hit-confirmed gunfire.
Misses lack a replicated event. Further surface banks, shot events, occlusion,
reverb zones and priority voice stealing remain separate work. No target-machine
performance claim or listening verdict is implied by unit tests.
