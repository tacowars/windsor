# The arrangement console: one UI driving the real engine, arrangements as loaded documents

- Date: 2026-08-31
- Links: **supersedes in part**
  `docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md` §2 and §9 ·
  builds on
  `docs/log/2026-08-31-generative-sequencing-transport-and-pitch.md` ·
  issues #68 · #69 · #70 ·
  scope exception on the terms of
  `docs/log/2026-08-31-audio-enters-tech-demo-scope.md`

A design conversation with tacowars, recorded before any code exists. No
implementation was written.

tacowars asked for one UI covering the mixer, the sequencers, the harmonic
parameters and the synth patches in tabs — enough to compose the whole
arrangement without editing source. That is a direct revisit of the mixer
record's §9, on the trigger that record itself named: *revisit when several
parts are actually making noise together*. #69 is what makes them.

## What this supersedes

Two decisions from the mixer record are narrowed, and both should be read
through this record from here on:

- **§2, "mixing is a code edit rather than a knob."** No longer true. Mix and
  arrangement state round-trips through a JSON document (§3 below). The typed
  tables survive as defaults, not as the only authoring route.
- **§9, "the patch editor stays a sound-design tool."** No longer true. It
  becomes an arrangement console. The reasoning in §9 was that mixing by ear
  needs something to hear and nothing was making sound; #69 removes that.

The rest of both earlier records stands unchanged — the routing, the gain
staging, the pan rotation, the transport and the generative pitch source are
all untouched.

## Decision

### 1. The console drives the real engine, not a copy of it

Today the editor is a UI that **reimplements** the engine. `build-editor.mjs`
bundles only the patch schema — `index-for-editor.ts` deliberately excludes the
engine because `index.ts` reaches Babylon — and the template then builds its own
Web Audio graph and loads the worklets from inlined strings via blob URLs
(`editor-template.html:772`). The only thing guaranteed not to drift is the
patch format.

The console instead runs the actual `AudioSystem`, `Scheduler`, sequencers and
mixer. What tacowars composes is then literally what the game plays, rather than
what a second implementation of it sounds like.

Two things make that possible, and both are small **if designed in while #68
and #69 are being written** rather than retrofitted:

- **Widen the editor-safe entry.** `index-for-editor.ts` grows to export the
  engine. The exclusion only ever needed to cover `babylonBridge.ts`, which is
  the sole module importing Babylon; `fmEngine`, `audioBus`, `audioPart` and
  `audioSystem` touch nothing but Web Audio.
- **Give `FmEngine.init()` override URLs.** `WORKLET_URL` is
  `new URL('./worklet/fm-processor.js', import.meta.url)`
  (`workletMessages.ts:57`) — correct under Vite, meaningless in a single
  standalone file. `init({ fmUrl, reverbUrl })` lets the console pass the blob
  URLs it already makes, and changes nothing for the game.

The cost accepted: the template's hand-rolled graph code is refactored onto the
real classes. That is the bulk of the engine-side work in #70.

### 2. Five tabs

| Tab | Owns |
|---|---|
| Parts | the existing FM editor — per-part patch, operators, envelopes |
| Mixer | strips (level, pan, sends), returns, spaces |
| Sequencers | per-part driver: Euclidean `k`/`n`, density modulator, arp mode and skip, step divisor and gate |
| Harmony | key, scale, degree weights, register split per part |
| Arrangement | transport and bpm, document export/import |

tacowars listed LFO periods alongside the harmonic parameters; they live in
**Sequencers**, because they modulate Euclidean density rather than pitch. The
LFO inside a `Patch` is a different thing again and stays in Parts.

### 3. An arrangement is a JSON document loaded at runtime

Mix and arrangement state serialises to JSON, exported from the console and
loaded by the game as an asset. This is the decision that supersedes §2.

Consequences, accepted deliberately:

- **This is the client's first runtime asset load.** There is no `fetch` call
  anywhere in `packages/client/src` today and no `assets/` directory. It adds a
  load order, a failure path, and a question about what sounds before the
  document arrives — see §4.
- **The arrangement leaves code review.** A JSON file is not read the way a
  typed table is. That is the price of composing by ear, and it is worth it.

### 4. Code defaults stay, as the fallback the document overlays

The typed tables from #68 and #69 (`MIX`, `RETURNS`, the arrangement defaults)
remain in source and remain the starting state. A loaded document **overlays**
them field by field; it does not replace them.

So a missing document, a malformed one, or a field the schema gained since the
document was written all degrade to a sound rather than to silence or a crash.
The game is never one bad JSON file away from being mute.

### 5. Validation is a normaliser, not a schema library

The repo has no validation dependency and should not gain one for this. The
established idiom is already the right one: `makeSpace(Partial<ReverbSpace>)`
(`reverbSpace.ts:129`) and the `num(raw.volume, 0.8)` clamping in
`fm-processor.js:946`.

`makeArrangement(raw: unknown)` follows it — clamp every number to its range,
default every absent field, drop every unknown key, and **never throw**. A
loader that throws on a document tacowars exported five minutes earlier is worse
than one that quietly plays the defaults for one field.

### 6. Authoring is parametric, with capture-to-fixed

Knobs, weights, ranges and divisors are the interface — consistent with the
generative pitch decision. But a generated bar that sounds right can be
**captured**: frozen into a fixed pattern that can be kept, nudged, or released
back to generative.

This is the workflow generative music actually wants — audition, then keep the
good one — and it is far less UI than a step grid. A captured pattern is a
literal array in the document, so capture is also how a happy accident survives
a reload.

## Why

The through-line is **one source of truth per thing**.

The engine decision (§1) says there is one implementation of the audio graph
and the console drives it, rather than two implementations that agree until
they don't. The build script's own header already argues this for the patch
schema — "both come from the real client source, so the editor cannot drift
from what the game runs" — and §1 simply extends the same principle from the
schema to the engine.

The document decision (§3–§4) says the same about arrangement state: one
schema, defaults in code, overrides in a document, one normaliser between them.
The alternative — a console that keeps its own state and a game that keeps its
own — is the same drift in a different costume.

Constraints unchanged: **audio never feeds back into simulation state**
(CLAUDE.md invariant 1), and the console is a development tool, so nothing here
is a milestone measurement (invariant 3).

## Punted / alternatives

| Rejected | Why not |
|---|---|
| Console keeps its page-local graph, bundles only data | A second implementation of #68's routing — precisely the drift the build script exists to prevent |
| Console in-game behind `?debug=1` instead | Drives the real engine for free, but needs the dev server and is not publishable as an Artifact |
| Shared UI mounted in both a standalone file and an in-game overlay | Most reach, largest build; the standalone no-imports constraint would shape the whole UI layer |
| Copy the arrangement to the clipboard as a TypeScript literal | Keeps mix under code review and works in the Artifact sandbox, but no round-trip back in |
| Copy out and paste back in | Round-trips, but still hand-carried, and needs the same validation as a document without the benefits |
| The published Artifact persists arrangements itself | Nothing to paste, but state lives outside the repo and the game and console can silently disagree |
| Purely parametric, no capture | Smallest UI; when a phrase is almost right you can only re-roll, never keep it |
| Per-step overrides on a grid | Finer than capture, but that is most of a tracker's UI |
| A full grid/note editor | The largest single piece of UI in the console, and it competes with the generative design rather than completing it |
| Fold the console into #69 | One very large PR: transport, four sequencer types, four parts and a five-tab console in one review |
| Build the console before the parts | UI early, with almost nothing to control until the sequencers exist |

Note for whoever builds #70: a page-initiated **download works in the local
file but is silently blocked in the published Artifact sandbox**. Export must
therefore offer a clipboard path as well, or it will appear broken to anyone
using the Artifact.
