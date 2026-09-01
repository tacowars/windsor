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

The design doc asks for three things that sampled audio serves badly:

| Requirement (GDD) | Why samples struggle | What synthesis gives |
|---|---|---|
| §5.3 — DRG-style telegraph: ambient drop-out → rumble → horn, and *"the AI goes quiet mid-sentence"* | The tell is a continuous, parameterised transition, not a clip | Ambience is generated, so it can be bent in real time; a horn can bend pitch with wave proximity |
| §5.3 — *"distinct audio per enemy type"*, readability over realism | Every variant is another file; families of related sounds drift apart | One patch family, parameter offsets per enemy; kinship is audible by construction |
| §3.3 — the AI character as a persistent voice | Voice lines are the largest asset class in a browser build | A formant-ish FM voice can carry non-verbal presence without shipping audio |

Two further arguments specific to a browser game:

- **Bundle.** The whole engine plus its patch set is well under 100 KB. A modest sampled
  set is megabytes. The client already budgets carefully around Babylon's size
  (`CLAUDE.md` invariant 5, and the `@babylonjs/inspector` externalisation in
  `packages/client/vite.config.ts`).
- **Cross-origin isolation.** The dev server already sends
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy:
  require-corp` for Havok. Under `require-corp`, every cross-origin subresource must
  opt in with CORP headers — which means a CDN-hosted audio asset is a live problem and
  a generated waveform is not. This is a real constraint the project has already
  accepted for physics, and audio inherits it.

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
| Operators | 4 per voice, 11 algorithms, per-operator feedback |
| Waveforms | Sine, saw, square, triangle, noise; unbandlimited "digital" saw/square; 4-bit and 8-bit sine; user-defined harmonics |
| Envelopes | Per operator, plus filter and pitch: Init/Attack/Peak/Decay/Sustain/Release/End, per-segment curve, key scaling, three loop modes |
| Filter | Per-voice state-variable (TPT): LP/HP/BP/notch, 12 or 24 dB, resonance, drive, envelope, LFO, key tracking |
| Modulation | Per-voice LFO (7 shapes) to pitch, filter and any operator; pitch envelope; glide; unison spread |

**Not** a chip emulation. The OPL/OPM register interface, the fixed voice count, the
fixed sample rate and the single hard-panned output bus are all absent by choice: the
last of those makes per-voice routing impossible, which is precisely what a 3D game
needs. Waveforms are built from harmonic partials into per-octave bandlimited tables,
which is what makes saw and square usable as FM operators at all.

### Division of labour

Only the FM runs in the AudioWorklet. Everything else uses native Web Audio nodes, which
execute in the browser's own audio thread and cost nothing from the JS main-thread budget
that [tech-demo-proposal.md](tech-demo-proposal.md) §1 identifies as the project's
primary risk:

| Concern | Where |
|---|---|
| FM voices, per-voice filter, envelopes, LFO | AudioWorklet (ours) |
| Bus tone shaping, reverb, delay, distortion, compression | `BiquadFilterNode`, `ConvolverNode`, `DelayNode`, `WaveShaperNode`, `DynamicsCompressorNode` |
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
  mix.ts                # the desk: RETURNS and MIX, typed plain data
  returnBus.ts          # sends and returns: the plate and the delay, 100% wet
  channelStrip.ts       # one part through its strip: fader, rotation, sends
  stereoRotate.ts       # the pan matrix (splitter -> 4 gains -> merger)
  scheduler.ts          # look-ahead note scheduling
  offlineRender.ts      # bake a patch to an AudioBuffer
  babylonBridge.ts      # the Babylon Audio Engine v2 seam
  patch.ts              # schema, enums, algorithm routing table
  presets.ts            # the game's patch set
  workletMessages.ts    # main-thread <-> worklet contract
  worklet/              # the DSP (§6.1)
  __fixtures__/         # headless worklet harness, Node-only
tools/patch-editor/     # authoring tool, outside the client bundle
```

This follows the `area:*` mirroring rule in `CLAUDE.md` — an `area:audio` ticket points at
one directory — and the systems rule: an explicit `update(dt)` owned by the loop, never
logic inlined in `runRenderLoop`.

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

```typescript
import {
  CreateAudioEngineAsync,
  CreateSoundSourceAsync,
} from '@babylonjs/core/AudioV2/webAudio';

// One context for the whole client.
const ctx = new AudioContext({ latencyHint: 'interactive' });
await ctx.audioWorklet.addModule(workletUrl);

const audio = await CreateAudioEngineAsync({ audioContext: ctx });
await audio.unlockAsync();          // required before any play(); browser autoplay policy

// A part (or the tail of its effect chain) becomes a Babylon sound source.
const turretVoice = await CreateSoundSourceAsync('turret', partNode, {
  spatialEnabled: true,
}, audio);
turretVoice.spatial.attach(turretMesh);
```

**Verification.** Read from the installed typings in
`node_modules/@babylonjs/core` at **9.23.0**, matching the `^9.23.0` pin in
`packages/client/package.json` — source of truth (1) in `CLAUDE.md`'s ordering. The same
symbols were cross-checked against the `BabylonJS/Babylon.js` repository at tag `9.23.0`
and agree.

| API | Location (`node_modules/@babylonjs/core/AudioV2/…`) |
|---|---|
| `IWebAudioEngineOptions.audioContext: AudioContext` | `webAudio/webAudioEngine.d.ts:22` |
| `CreateAudioEngineAsync(options)` | `webAudio/webAudioEngine.d.ts` |
| `AudioEngineV2.createSoundSourceAsync(name, source: AudioNode, options?)` | `abstractAudio/audioEngineV2.d.ts:169` |
| `CreateSoundSourceAsync(name, source, options?, engine?)` | `abstractAudio/audioEngineV2.d.ts:282` |
| `unlockAsync()` | `abstractAudio/audioEngineV2.d.ts:211` |

One trap worth recording: on the WebAudio engine *class*, `createSoundSourceAsync` is
tagged `@internal` — but so is `createSoundAsync`, which is unambiguously public API. The
public surface is the abstract declaration on `AudioEngineV2` and the free
`CreateSoundSourceAsync` function; the tag is on the implementation override, not the
contract.

Two notes the vendored `babylonjs` skill makes that apply directly:

- Write v2 only. The v1 `Sound` / `AudioEngine` classes are legacy and are one of the
  deprecated idioms the skill warns creeps in from third-party posts.
- Audio engines hold GPU/OS resources and are not garbage-collected — dispose them.

Deep-import per invariant 5: `@babylonjs/core/AudioV2/webAudio`, never the barrel.

---

## 6. Constraints this repo imposes on the implementation

### 6.1 The worklet is one file, deliberately

The DSP is ~1,150 lines against a `max-lines` cap of 300, and stays that way behind a
file-top disable with its reasoning. Decision:
`docs/log/2026-08-31-audio-worklet-single-file.md`.

An earlier draft of this document flagged worklet bundling as an unresolved spike that
blocked any audio ticket. **Keeping the file whole is what resolved it.** Because it has
no `import` statements, `new URL('./worklet/fm-processor.js', import.meta.url)` resolves
in both the dev server and the production build with no bundler configuration. Splitting
it would reintroduce the problem: Vite's `?url` and `new URL(…, import.meta.url)` yield a
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
  reading comes from.
- Suggested criterion, to be argued when the ticket is written: **zero underruns over a
  60 s M3-equivalent horde window, with audio scheduling under 0.5 ms of main-thread time
  per frame at p95.**

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
2. **Music structure.** Whether the soundtrack is a sequenced arrangement driven by the
   scheduler, or purely reactive layers. This decides whether a transport and pattern
   format are needed at all; `scheduler.ts` currently supports either.
3. **Whether a sampled layer is ever added** (§2), and if so where it sits relative to
   this one.

Two questions from earlier drafts are now settled and recorded rather than pending:
worklet bundling (§6.1, `2026-08-31-audio-worklet-single-file`) and audio's standing
against invariant 4 (§1, `2026-08-31-audio-enters-tech-demo-scope`).

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
