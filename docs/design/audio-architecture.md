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

**FM, plate reverb and the compressor insert use our worklets; other effects use native Web Audio nodes**, which execute in the
browser's own audio thread and cost nothing from the JS main-thread budget that
[tech-demo-proposal.md](tech-demo-proposal.md) §1 identifies as the project's primary
risk. This section first said "only the FM runs in the AudioWorklet";
`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` decision 4 removed the `ConvolverNode`
path outright — `generateImpulseResponse` and the convolver are gone — and put the reverb
in a second worklet of its own:

| Concern | Where |
|---|---|
| FM voices, per-voice filter, envelopes, LFO | AudioWorklet (ours): `worklet/fm/`, bundled to `worklet/generated/fm-processor.js` (#643) |
| Reverb | AudioWorklet (ours): `worklet/reverb/`, bundled to `worklet/generated/reverb-processor.js` (#671), a Dattorro plate. **No `ConvolverNode`** — it was removed, not left beside it |
| Advanced Drive (#701) | AudioWorklet: `worklet/advancedDrive/`; 2x oversampled shapers, five routes, per-stage filtering and modulation; Classic Drive stays native |
| Glue-inspired part compressor (#660) | AudioWorklet: `worklet/compressor/`, bundled into `generated/compressor-processor.js`; feedback behavioral approximation, detector input reserved for future routing |
| Bus tone shaping, delay, distortion, master safety compression | `BiquadFilterNode`, `DelayNode`, `WaveShaperNode`, `DynamicsCompressorNode` |
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
packages/client/src/audio/          # folders mirror the music-engine skill's file map (#655)
  index.ts                # the public surface the game imports
  index-for-editor.ts     # the same minus babylonBridge, for the console
  audioConstants.ts       # the area's tables (re-exports the worklet's data modules, #656)
  game/                   # audioSystem.ts (the system: update(dt), owned by the render loop),
                          #   arrangementLibrary.ts (?music= selection), musicOptions.ts,
                          #   musicControls.ts, babylonBridge.ts (the Babylon Audio Engine v2 seam)
  synth/                  # fmEngine.ts (context, worklet modules, parts, buses), audioPart.ts (one
                          #   timbral part == one worklet node), workletMessages.ts (main-thread <-> worklet
                          #   contract and the worklet URLs), the fmProcessor*.test.ts behavioural tests
  mixer/                  # mix.ts (the desk: RETURNS and the SFX strips, typed plain data), audioBus.ts
                          #   (dry buses with inserts), channelStrip.ts (one part through its strip: fader,
                          #   stages, rotation and sends off the tail), lowCutStage.ts (#640), insertChain.ts
                          #   + stripTap.ts (#639, #652), stereoRotate.ts (the pan matrix), returnBus.ts
                          #   (the plate and the delay, 100% wet), reverbSpace.ts, deskApply.ts, mixLevels.ts,
                          #   tanhCurve.ts (the inserts' shared clip curve)
  inserts/                # strip insert kinds: the registry, drive (#641), chorus (#642), compressor (#660)
  patch/                  # patch.ts (schema, enums; the algorithm table re-exported from the worklet),
                          #   patchNormalise.ts, patchLibrary.ts (the patches/*.json contract, #561),
                          #   presets.ts (the whole-bank table — editor/test only, #562), gameplayPatches.ts
                          #   (the patches game code plays, by id), presetCatalog.ts, patchFileSerialise.ts
  patches/                # the patch library: one <id>.json per patch, plus a generated index.ts
  song/                   # arrangement.ts (the part list: slot, name, preset, sequencer kind, #597),
                          #   arrangementDocument.ts (makeArrangement: the never-throws version-2
                          #   normaliser) over arrangementNormalise.ts, arrangementFields.ts,
                          #   sequencerNormalise.ts, deskNormalise.ts; arrangementValidate.ts (PatchResolver,
                          #   #562); arrangementPlayer.ts (binds each part's sequencer to its engine part, by
                          #   slot); documentParts.ts; fallbackArrangement.ts (the diagnostic click)
  arrangements/           # the committed song documents, one <name>.json each (since #704 only a placeholder
                          #   bed-01; tacowars's own song replaces it after the harmony v2 epic, #703)
  sequencing/             # scheduler.ts (look-ahead note scheduling) and the generators: grid, chord,
                          #   euclidean, over scaleSampler.ts (the key's degree → note mapping, no weights),
                          #   euclid.ts, noteEvent.ts, generatorSeed.ts; generatorBoundary.test.ts keeps them
                          #   off the audio graph. The arp and step generators, the degree weights and pitched
                          #   capture were deleted in #704; their replacements are epic #703's
  harmony/                # chordTheory.ts, chordNames.ts, chordVoicing.ts, chordTables.ts, chordNormalise.ts
  cost/                   # audioCost.ts (the overlay and bench readout), audioLoad.ts (audio-thread load),
                          #   schedCost.ts (main-thread scheduler cost), playbackStats.ts (underruns)
  sfx/                    # the gameplay SFX path (Babylon AudioV2, not the music engine's): gameplaySfx.ts,
                          #   actionSfx.ts, spatialSfx.ts, sfxSelection.ts, sfxBuffers.ts, createGameplaySfx.ts,
                          #   sfxConstants.ts, footstepCadence.ts; offlineRender.ts bakes a patch to an AudioBuffer
  worklet/                # the DSP (§6.1): generated/ holds the bundles (#643)
    fm/                   # the FM source, TypeScript in its own project (#644, #645, #654): fmProcessor.ts (entry), voice,
                          #   voiceControl, voiceRender, voiceKernel, fmConstants, waveTables,
                          #   algorithms, envelope, lfo, svf, prng, patchNormalise
    compressor/           # the compressor insert's processor (#660)
    reverb/               # the plate's source (#671): reverbProcessor.ts (entry), delayLines, tank, reverbConstants
  __fixtures__/           # headless worklet harness and the fake audio graph, Node-only; shared by every folder
tools/patch-editor/     # authoring tool, outside the client bundle
```

This follows the `area:*` mirroring rule in `CLAUDE.md` — an `area:audio` ticket points at
one directory — and the systems rule: an explicit `update(dt)` owned by the loop, never
logic inlined in `runRenderLoop`.

**A song is a list of parts, each with any sequencer** (#597, record
`2026-09-17-music-parts-are-a-slot-list-with-a-sequencer-kind`). An
`arrangements/<name>.json` has 1–8 `parts` (the document is `version: 3`, #705 — its
timeline, harmony and regions are the Song view paragraph below); each part sits on a
unique `slot` 0–7, carries its own `strip` (level, pan, low cut, sends, inserts) and a
`sequencer` whose `kind` is `euclidean` (a fixed-note trigger), `grid` (a written 1–32
step line of scale degrees, #602), `chord` (the Chord Player: written hits that voice the
harmony timeline's chord, one voicing per part, #606, #705), `arp` (the Arpeggiator over
the active chord, #706), `bass` (the Bass / Drone: root, chord or a fixed-degree pedal,
#707) or `none` (inert: built and playable from the keyboard, never sequenced). The slot
is the part's identity — its engine part is `music-<slot>`, and its generator stream is
its own sequencer's `seed`, hashed per region entry (`generatorSeed.ts`, #705) — so
removing, reordering or renaming a part never moves another part's notes; the name is a
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

**The Song view (#709)** is where a version-3 song is authored (epic #703; record
`2026-09-26-harmony-v2-document-v3-timeline-and-regions`): a bar ruler of
`transport.bars`, the harmony lane — one block per `harmony.events` entry, contiguous
from tick 0, the last holding to the song end — one lane of `regions` per part by
slot, one playhead line placed from the transport's audible tick, and a detail pane
under the lanes hosting the selected part's sequencer card or the selected chord's
harmony card. A region is where a part's one pattern is live; a gap is a rest; the
pattern restarts on entry to a region and free-runs in the one whole-song region (∞).
The view draws from the engine's own rules — `sequencing/regionClock.ts` for the
position, `harmony/harmonyTimeline.ts` for the block bounds and the chord under the
playhead — so what the lanes show is what the region gate plays, and every edit is a
live partial over the console's pure `regionModel.ts` / `harmonyLaneModel.ts`, never a
rebuild. The console's layers are `tools/patch-editor/CLAUDE.md` "The Song view".

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

**The seam is built: `packages/client/src/audio/game/babylonBridge.ts`.** Read it rather than a
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

**Amended 2026-09-23 (#643)**: the FM worklet still *ships* as one file but is
*written* as a source folder, `worklet/fm/`, which `scripts/build-worklets.mjs`
bundles into `worklet/generated/fm-processor.js` (`--check` in `npm run verify`;
`worklet/CLAUDE.md` holds the rules). The bundle transforms nothing, so the
reasoning below still describes what the shipped file is; what it no longer
describes is how the source is kept. Record
`2026-09-23-643-fm-worklet-is-generated-from-a-source-folder`; the split itself
is #644 and #645. The reverb was, at that point, still one hand-written file.

**Amended 2026-09-23 (#671)**: no longer — the plate is written as
`worklet/reverb/` (`reverbProcessor.ts`, `delayLines.ts`, `tank.ts`,
`reverbConstants.ts`, TypeScript in its own project) and bundled into
`worklet/generated/reverb-processor.js`, pinned bit for bit by
`mixer/reverbGolden.test.ts`. Record
`2026-09-23-671-reverb-worklet-methods-installed-on-the-prototype`.

*History — the rule as first written, before the two amendments above.* There
were two hand-written worklets: `worklet/fm-processor.js` (1,302 lines) and
`worklet/reverb-processor.js` (460), each far over the `max-lines` cap of 300 and each
kept that way behind a file-top disable with its reasoning. Decision:
`docs/log/2026-08-31-audio-worklet-single-file.md`; the reverb's own
`docs/log/2026-08-31-dattorro-reverb-not-plateau.md` decision 4. Neither is hand-written
now: each is a source folder (`worklet/fm/`, `worklet/reverb/`) bundled into
`worklet/generated/`.

An earlier draft of this document flagged worklet bundling as an unresolved spike that
blocked any audio ticket. **Keeping each file whole is what resolved it**, and the
reasoning still holds for the generated files: because neither shipped file had an
`import` statement, `new URL('./worklet/<name>.js', import.meta.url)` resolved in both
the dev server and the production build with no bundler configuration, and the build
step keeps it so by emitting import-free bundles. Letting a worklet's source split reach
the browser as-is would reintroduce the problem: Vite's `?url` and `new URL(…, import.meta.url)` yield a
URL for the file itself *without* bundling its dependency graph — fine in dev, broken in
a build — so a split worklet needs a second Rollup input, a `?worker&url` indirection, or
a bespoke build step.

**Amended 2026-09-23 (#656)**: the duplication below is gone — `patch.ts` and
`audioConstants.ts` re-export the wave ids and the algorithm table from the
worklet's own modules, and the console draws envelopes with the worklet's
`segmentLevel`; the PRNG copy stays, pinned by `prng.test.ts`, because the
worklet bundle cannot import the shared package without carrying it whole.

The cost was duplication: the waveform enums and the algorithm routing table existed both in
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
- **On the audio thread.** `packages/client/src/audio/cost/audioLoad.ts` owns
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
`packages/client/src/audio/cost/audioCost.ts`'s `AudioCostReadout`, which is what
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

The sampled layer anticipated in §2 is adopted by tacowars's 2026-09-12 decision:
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

### Song master (#666)

Music dry paths retain their existing bus highpass; its output and both
returns sum before the song master inserts and output level. The game Music
volume follows this master, while gameplay SFX remain separate. An optional
`master: { level, inserts }` document section stores the settings; absent means
unity/no inserts. The console reuses insert cards for this Master strip and
displays independent L/R sample peaks before game volume/safety compression.
Its view-owned meter worklet runs only while visible. Ownership and compatibility
are recorded in `docs/log/2026-09-23-666-song-master-and-stereo-meter.md`.


### Post-FX sidechains and silent triggers (#667)

A compressor's `sidechain` is `"internal"` (also the meaning of an omitted
field), or `{ "track": <slot> }`. The source is that track's stereo signal
after Level, low cut and inserts, before pan and audible output. One track
can feed multiple track/master compressors. `{ "track": null }` is a
visible, disconnected external detector; silence never falls back to Internal.

A strip's optional `output` is `"master"` by default or `"sidechain"`.
Sidechain only leaves the instrument and effects running, gates dry and send
paths together, and preserves existing return tails. The gate takes the
insert edit fade time; the track Level stays before effects.

`mixer/sidechainGraph.ts` is the common graph rule, `sidechainPlan.ts` checks
prospective live edits, and `sidechainDesk.ts`/`sidechainRouter.ts` own the
transaction and detector connections. `InsertChain.specs` names the settings
actually applied: routing is reconciled after a deferred insert edit lands,
not against an old stage order. Imports disconnect missing/cyclic references
with a report; live cycles are refused before any song mutation. Deleting a
source clears its references to disconnected external, so a reused slot
cannot become the old trigger. The selector disables self/cyclic choices.
