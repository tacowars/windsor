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

- **§2, "mixing is a code edit rather than a knob."** Narrowed, not reversed.
  Mix and arrangement state round-trips through a JSON document (§3), so it is
  no longer *hand-edited* — but the document is committed and imported at build
  time, so it stays in code review and in a diff. The typed tables survive as
  the seed, not as the only authoring route.
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

### 3. An arrangement is a JSON document imported at build time

The console exports JSON; the file is committed; the game `import`s it as a
module. There is **no runtime load**.

```ts
import raw from './arrangements/bed-01.json';
const arrangement = makeArrangement(raw);
```

`tsconfig.base.json` needs `resolveJsonModule`; `moduleResolution` is already
`bundler`, and Vite bundles JSON natively.

This was originally specified as a runtime `fetch`, and tacowars rejected that on an
argument that holds: with generative audio, a document that fails to load and
falls back to defaults is **undetectable by ear**, because sounding different
from last time is the expected output. A runtime load needs a failure signal,
and every available signal is bad — a console warning scrolls past, an
on-screen badge relies on being noticed, and silence is ambiguous.

Importing at build time does not choose a better signal. It **deletes the
failure class**: a malformed document fails `npm run build`, loudly, at the
moment someone can act on it, and cannot reach a running game at all.

Three things fall out, all of them simplifications:

- **The client gains no `fetch`.** There is none in `packages/client/src`
  today, and this no longer adds the first one, nor a load order, nor an
  "what plays before the document arrives" question.
- **The arrangement stays under code review.** A committed JSON file appears in
  a diff. The §2 supersession is therefore narrower than first written: mixing
  stops being a *hand-edit*, but it does not leave review.
- **The composing loop gets faster, not slower.** Export from the console over
  `arrangements/bed-01.json` and Vite's HMR reloads it immediately. The cost —
  no arrangement hot-swap in a built game — is not a cost during a tech demo.

### 4. The fallback is a diagnostic click, not a musical default

tacowars's objection applies to fallbacks in general, not just to loading: a
hardwired musical default standing in for the real arrangement is invisible
precisely because the real arrangement is generative.

So "defaults" splits into two things that were previously one, and they are not
interchangeable:

| | What it is | When it plays |
|---|---|---|
| The shipped arrangement | the actual bed — musical, committed, authored by hand in #69 and by the console from #70 on | normally |
| `FALLBACK_ARRANGEMENT` | a bare metronome click. No sends, no harmony, no generative parts | only when no usable arrangement survives normalisation |

The fallback is **deliberately unmusical**, so it can never be mistaken for the
arrangement. It is also more informative than silence: a click proves the
context resumed, the worklets loaded, the routing works and the master path is
open, which narrows the fault to the document alone. Silence proves nothing —
it is equally a suspended context, a missing gesture, a zero send, or a broken
sequencer.

That distinction is not hypothetical here. **Silence has already failed as a
signal in this codebase**: nothing has ever called `createMusicPart`, so the
client has been mute since the FM engine landed, and the convolver reverb in
PR #39 shipped and merged without anyone hearing it. An error state that
sounds like the project's normal state is not an error state.

### 5. Validation never throws at runtime, and `verify` fails if the fallback would play

`makeArrangement(raw: unknown)` follows the repo's established idiom rather
than a new dependency — `makeSpace(Partial<ReverbSpace>)` (`reverbSpace.ts:129`)
and the `num(raw.volume, 0.8)` clamping in `fm-processor.js:946`. It clamps
every number to its range, defaults every absent field, drops unknown keys, and
does not throw.

It also **reports**: it returns the normalised arrangement alongside a list of
what it had to correct, and distinguishes a document it repaired from one it
could not use at all.

The guard that closes the loop is a build-time assertion, not a runtime one:

- **`npm run verify` fails if the committed arrangement normalises to
  `FALLBACK_ARRANGEMENT`**, and fails on any dangling reference — a preset,
  return or part name the document mentions and the code does not define.
  Clamping cannot fix a dangling name; it is an error wearing a valid type.
- A repaired-but-usable document logs what was corrected and still plays.

So the fallback exists to keep a running game from crashing, and the gate exists
to guarantee it is never what ships. This is also the answer to the obvious
objection to §4 — "someone will eventually ship the click" — made structural
rather than left to vigilance.

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

The document decision (§3–§5) says the same about arrangement state: one
schema, one committed document, one normaliser, and one gate proving the
document is real before it ships. The alternative — a console that keeps its own
state and a game that keeps its own — is the same drift in a different costume.

There is a second principle under §3 and §5, which is that **a failure should
be moved to where it is loud rather than dressed in a better warning**. A
malformed arrangement is a build error, a dangling name is a verify failure,
and the only thing left at runtime is a fallback that announces itself by
sounding wrong.

Constraints unchanged: **audio never feeds back into simulation state**
(CLAUDE.md invariant 1), and the console is a development tool, so nothing here
is a milestone measurement (invariant 3).

## Punted / alternatives

| Rejected | Why not |
|---|---|
| Console keeps its page-local graph, bundles only data | A second implementation of #68's routing — precisely the drift the build script exists to prevent |
| Console in-game behind `?debug=1` instead | Drives the real engine for free, but needs the dev server running rather than one openable file |
| Shared UI mounted in both a standalone file and an in-game overlay | Most reach, largest build; the standalone no-imports constraint would shape the whole UI layer |
| Copy the arrangement to the clipboard as a TypeScript literal | Keeps mix under code review, but no round-trip back in |
| Runtime `fetch` with a lenient overlay onto musical defaults | Originally specified here and rejected: a failed load is inaudible when the content is generative |
| Runtime `fetch` that falls silent on failure | Unmissable in principle, but silence has already gone undetected for this entire project and cannot distinguish a failed load from a suspended context |
| Runtime `fetch` that throws with an on-screen banner | Better than silence, but still a signal someone has to notice; build-time import removes the failure instead |
| Deleting the code-side arrangement entirely | Unambiguous, but #68 and #69 could then make no sound at all before #70 lands |
| Keeping unnamed musical defaults | Exactly the invisibility tacowars objected to |
| Copy out and paste back in | Round-trips, but still hand-carried, and needs the same validation as a document without the benefits |
| A hosted console persisting arrangements itself | Nothing to paste, but state lives outside the repo and the game and console can silently disagree |
| Purely parametric, no capture | Smallest UI; when a phrase is almost right you can only re-roll, never keep it |
| Per-step overrides on a grid | Finer than capture, but that is most of a tracker's UI |
| A full grid/note editor | The largest single piece of UI in the console, and it competes with the generative design rather than completing it |
| Fold the console into #69 | One very large PR: transport, four sequencer types, four parts and a five-tab console in one review |
| Build the console before the parts | UI early, with almost nothing to control until the sequencers exist |

### The console is a local tool, not a published Artifact

Decided by tacowars while this record was being written. The editor had previously
been published to claude.ai as "Seedship FM Console"; the console is not, and
nothing in this design targets that.

Two constraints lift as a result, and #70 should take both:

- **Export can simply download a file.** A page-initiated download is blocked
  in the Artifact viewer sandbox but works normally from a local file or a
  static server, which is how tacowars runs the editor.
- **`build-editor.mjs`'s document guard can go.** It currently throws if the
  generated HTML contains `<!doctype>`, `<html>`, `<head>` or `<body>`, purely
  because the Artifact host supplied its own skeleton. Without that host the
  console should be a complete standalone HTML document.
