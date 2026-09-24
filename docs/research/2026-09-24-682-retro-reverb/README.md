# Adjustable vintage reverb insert (#682)

tacowars chose a freely adjustable MIDIVerb-inspired effect, ordinary/gated/reverse
presets approximating the original range, and no factory ROM in shipped assets.
The result is **original DSP, not an emulator or a verified factory match**.
Listening approval and further preset tuning remain tacowars's verdict.

## Source findings

- Local BarrVerb revision: `84d06af27673cf8544368f125e5fb0ce485caea2`.
  Its [README and source](https://github.com/ErroneousBosh/BarrVerb) distinguish
  ISC emulator code from factory ROM copyright. Its digital core is small:
  128 instruction steps per internal sample and 16,384 signed 16-bit RAM words
  (32 KiB, a storage count, not a measured process footprint).
- BarrVerb averages stereo input to mono, produces stereo wet output, uses
  simplified arithmetic, runs at half the host sample rate, and duplicates
  output samples. The author documents approximate input filtering and no
  reconstruction filter. Thus porting it verbatim does not establish hardware
  fidelity, particularly outside a 48 kHz host.
- Eric Brombaugh's [MIDIVerb_RE](https://github.com/emeb/MIDIVerb_RE), inspected
  at `8ae01966ff13416872f38ede2c0f4fd7c7947788`, provides an MIT-licensed
  emulator, disassembler, compiler, schematic and analog filter models.
  The emulator includes one's-complement/sign-carry behavior and different
  converter scaling/input handling. The compiler removes instruction dispatch;
  compiling factory microcode is still use of the factory program data.
- tacowars's U51 file is the **DSP program ROM**, 16,384 bytes. Its MD5 is
  `11a460c8e64d3325411bba0c11a2ae49`, the MIDIVerb dump identified in the
  [independent emulator's supported-ROM list](https://github.com/thement/midiverb_emulator#supported-roms).
  SHA-256: `dcf2ff65fa0fe72eb811ef7e6713e06472809e892df47aa1639766c22ab4c362`.
  Depipelining using Brombaugh's `mk_mvucode.c` indexing matches BarrVerb's
  **all 63 effect programs exactly**. Slot 64 differs at instruction zero.
- tacowars's U54 file is 8,192 bytes; SHA-256
  `f70ce8e315126a3c74f0268b027bc6af1278dea18c03b4050cb17e7e9c600b05`.
  Sheet 1 of the [reverse-engineered schematic](https://github.com/emeb/MIDIVerb_RE/blob/main/schematics/MIDIVerb_Schematic.pdf)
  labels U51 DSP code and connects U54 to the 8031 controller. U54 is relevant
  to MIDI, buttons and selection rather than the reverb signal algorithms.
- Local disassembly recognizes 4, 5, 7 or 9 all-pass motifs in the ordinary
  programs and 6 in the gated/reverse programs. That is a heuristic motif
  count, not a complete signal-flow reconstruction. In particular, finite
  gated/reverse responses deserve their own signal path rather than an
  ordinary decay setting with a different label.

The firmware, disassemblies and decoded instruction arrays stayed outside the
worktree. No original delay offsets or compiled factory programs were imported.
The preset table maps the public program descriptions (duration, apparent size,
brightness and mode) to independently selected settings. It has **not** been
fitted to measured hardware impulse responses. Matching temporal shape,
density, spectrum and stereo correlation more closely is a subsequent audition
and calibration task; the names alone do not prove that match.

## Implementation choice

| Approach | Benefit | Cost / suitability here |
|---|---|---|
| TypeScript AudioWorklet | Existing build, lifecycle, instrumentation and editor support; easy parameter development | Selected. Uses the same engine in game and editor; no separate native toolchain |
| C/C++ core compiled to WASM inside an AudioWorklet | Reuses an existing DSP core; explicit integer behavior; can avoid JS hot-path allocation | Viable, not mandatory. Requires pinned compiler/build/CI, module loading and fixed memory. No WASM comparison was measured |
| Compile factory microcode into native/WASM functions | Removes interpreter dispatch without rewriting the program by hand | Useful for an emulator, but still depends on factory program data and retains fixed-program design constraints |
| Native convolution from captured responses | Useful reference for a static linear response | Does not reproduce level-dependent arithmetic or provide independent structural controls; not selected |

[Chrome's worklet design guide](https://developer.chrome.com/blog/audio-worklet-design-pattern/)
documents C/C++ WASM kernels inside JS worklets and the cost of copying audio
into/out of WASM memory. A future kernel should use one call per render block,
preallocated memory and initialization before playback. Avoid per-sample JS ↔
WASM calls, memory growth, locks and a worker round trip in the audio path.
[Emscripten's worklet documentation](https://emscripten.org/docs/api_reference/wasm_audio_worklets.html)
also supports integrating with an existing context without its shared-memory
worker runtime. WASM does not require an additional AudioContext or a virtual
audio device. A speedup for this particular algorithm must be measured.

The selected core uses a fixed 23,437.5 Hz internal clock, approximate
fourth-order converter filtering, an original four-line orthogonal feedback
network with three input all-passes, and an original finite reflection field
for gated/reverse envelopes. Character blends truncating low-resolution
conversion with the clean value. The dry stereo path remains at host rate.
All buffers and reflection data are allocated at construction; block updates
and render loops create no arrays, closures or objects. Load reports reuse
their object and use the engine's existing opt-in accounting.

Decay, size, tone, diffusion, pre-delay, character, mix, mode and finite-window
time are song settings. Numeric changes and mode blends are smoothed; size/time
sweeps can bend/smear the wet tail. Bypass fades to exact stereo dry while
history keeps advancing. Re-enabling can reveal a running tail. Removing the
insert uses the existing mixer fade/disposal behavior. No new source is
created per note, and finite effects overlap continuous input naturally.

## Evidence and cost

`bench.mjs` executes the **shipped processor callbacks**, including conversion
and filters, at 48 kHz / 128 frames. `initial-throughput.json` and
`throughput.json` retain three warmed repetitions per scenario. Machine:
Apple M1, macOS/Darwin 25.5.0, Node 24.20.0 / V8 13.6.233.17; no graphics
backend. These are offline throughput readings, **not browser real-time load,
dropout counts, or Ryzen target-box readings**.

| Instances | Ordinary, median ms/audio second | Gated | Reverse |
|---|---:|---:|---:|
| 1 | 5.81 | 22.73 | 22.61 |
| 8 | 46.01 | 181.31 | 180.76 |
| 16 | 90.98 | 362.48 | 361.66 |

Caching tap positions and weights at block rate reduced eight gated instances
from 279.35 to 181.31 ms/audio second on that machine. No general maximum
instance-count guarantee follows: all inserts share the context's audio
thread, and the eight-per-strip schema cap is not a worst-case CPU promise.

A separate local BarrVerb interpreter probe matched native C++ integer output
for 3,000,000 stereo sample pairs (64 slots, seeded noise followed by silence).
The JavaScript integer loop took a median 13.68 ms/audio second for one instance
on the same M1/Node backend, excluding converters, resampling and integration.
This was feasibility evidence for a port, not proof of hardware fidelity or
a comparison with WASM. The local probe is retained at
`/tmp/a204-midiverb-research/probe.mjs`; it reads tacowars's BarrVerb checkout and
generates native reference files only in that temporary directory.

`collect.mjs` drives the rebuilt file:// editor in Chrome. `browser.json`
records the browser/machine, page hash, track/master edits, export/re-import,
live output meter values and actual OfflineAudioContext impulse checks for
all three modes. `console.json`, `network.json`, `editor.png` and the saved
`audition-song.json` are the functional evidence. Chrome's file-page worklet
loading uses the existing data-URL fallback. Headless browser output is not
a listening verdict or a real-device underrun benchmark.

`build-size.json` compares production builds against `5d7a97b1`: the main
`index-*.js` grows from 727,989 to 729,536 bytes (+1,547; +412 gzip bytes).
The separate worklet asset is 15,817 bytes (4,117 gzip). The standalone editor
embeds that same processor. No Babylon import was added.

Reproduce from the worktree with Node 24:

```sh
node scripts/build-worklets.mjs
node tools/patch-editor/build-editor.mjs
node docs/research/2026-09-24-682-retro-reverb/bench.mjs
node docs/research/2026-09-24-682-retro-reverb/collect.mjs
```

## Audition

Open the worktree's `tools/patch-editor/patch-editor.html`, enable audio,
select Mixer and add **Retro reverb** on a track or Master. Try 01 for a short
bright space, 20 for a dark tail, 44/50 for long spaces, 51/59 for gates and
60/63 for rising responses. Use short notes or drum hits with ordinary room
and echo sends down. Mix is preserved on preset selection; try full wet to
hear the response alone, then return to an insert balance. Edit a sound knob:
the picker becomes Custom, and the values survive export/import. Time applies
to gated/reverse; Decay and Size apply to ordinary reverb. The bypass checkbox
covers the original Defeat role; the bank contains 63 effect approximations.

Tests and Chrome checks establish signal, state and timing behavior. tacowars still
needs to judge density, metallic coloration, long-tail usefulness and resemblance
to the original musical roles, especially under dense chords and repeated drums.
