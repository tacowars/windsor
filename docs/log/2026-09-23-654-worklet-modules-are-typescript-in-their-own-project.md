# The worklet modules are TypeScript in their own project

- Date: 2026-09-23
- Area: audio
- Links: issue #654 · epic #638 · amends `2026-08-31-audio-worklet-single-file` (TypeScript declined there, taken here) · builds on `2026-09-23-645-voice-hot-paths-are-functions-over-the-voice` · the plan `2026-09-23-638-worklet-refactor-optimised-for-agents` · reading `docs/research/2026-09-23-654-typescript-worklet-bench/`

## Decision

Every module under `worklet/fm/` is `.ts`, checked by its own project,
`fm/tsconfig.json`, which `npm run typecheck` runs as one more `tsc -p`;
esbuild bundles from it; ESLint's `.ts` rules apply. The bundle is the JS
bundle it replaces, byte for byte but for the banner, one dead argument and
one local alias; the golden table passed unchanged.

1. **A nested, non-composite project, not the client's.** The client project
   excludes the folder. Two settings differ from the client's, each for a
   reason a reader of `fm/tsconfig.json` sees:
   - `noUncheckedIndexedAccess: false`. The DSP indexes preallocated typed
     arrays by construction-bounded indices. Under the check every read takes
     a `!` and every compound assignment (`amp[i] += x`, `outL[k] += sig`)
     has to be rewritten as `amp[i] = amp[i]! + x`; the modules would stop
     being the line-for-line move the golden test proves, and every future
     hot-path line would fight the same check.
   - `useDefineForClassFields: false`. The first build left it at the ES2022
     default, and the bundle carried each declared field as `x;`, defining it
     as `undefined` before the constructor wrote a number. V8 then represents
     the field as tagged and boxes every later double write: the #548
     scenario read 336 ms against 182 ms, and each box is an allocation on
     the audio thread. Off, a declared field emits nothing, as in the JS, and
     the scenario reads 187 ms. `worklet/CLAUDE.md` rule 7 states the field
     rule for the next agent.
   - Not composite, because the modules import the main thread's *types*
     (`../../patch`, `../../workletMessages`) and a composite project must
     list every file it reaches, while the client project, which excludes
     the folder, cannot reference it back. The test project excludes the
     folder too and the folder's project checks its own tests.
2. **The worklet globals are declared locally** in `fm/workletGlobals.d.ts`:
   `sampleRate`, `currentFrame`, `registerProcessor`, an abstract
   `AudioWorkletProcessor`, and `AudioParamDescriptor`, none of which
   `lib.dom` declares for the processor side. `@types/audioworklet` was not
   taken: it is written for a scope without `lib.dom` and collides with it.
3. **`no-magic-numbers` is disabled per file, with a reason, never in the
   config.** `scripts/lib/eslintConfig.test.mjs` pins #246 decision 1: no
   exemption may be re-added under `packages/*/src`, and it reads the
   resolved severity of every file, so the folder-wide ignore this PR first
   tried failed it. Each DSP module opens instead with a one-line
   `eslint-disable no-magic-numbers` naming what its literals are (the
   filter polynomial, the xorshift shifts, MIDI and cents scales, the
   part's parameter ranges) and pointing at `fmConstants.ts` for the
   tunables, which the `*Constants.ts` pattern already exempts.
   `algorithms.ts` carries none: its numbers are the exempt 0–2 and indices.
   The patch defaults in `patchNormalise.ts` are the one set of data
   literals left; #656 shares them with `patch.ts`.
4. **Types only.** `this.x` fields are declared; parameters and returns are
   annotated; the normalised patch is `WorkletPatch` (`Patch` plus the
   feedback scratch); the message shapes come from `workletMessages.ts` by
   `import type`; a nullable field read on a hot path takes `!`. Three
   textual changes beyond annotation, each nil at runtime: a dead fifth
   argument to `getMips` in the warm-up loop is gone (TypeScript refuses it);
   `schedule` names its queued event `queued` for the frame stamp; the
   note-off fallback to `note` keeps a `!` because the contract has no such
   field.
5. **Direct tests beside each leaf module** (`prng`, `algorithms`,
   `envelope`, `lfo`, `svf`, `waveTables`, `patchNormalise`; 25 cases).
   `waveTables.ts` warms the wave cache at load and reads `sampleRate`, so a
   test of it or of a module that imports it sets `sampleRate` on
   `globalThis` and imports dynamically. The PRNG test pins `makeRandom`
   against the shared package's `mulberry32` for a thousand draws.

## Why

The single-file record declined TypeScript because compiling it would put a
build step between the source and the asset; #643 put one there. The plan's
item 5: an agent iterates on failing checks, and a plain-JS worklet gave it
none of `tsc`, the structure rules or typed imports. This ticket found its
own justification on the first bench: a conversion that looked complete and
passed every bit-identity test had doubled the cost of the hot path through
an emit default, and only the reading caught it. The `CLAUDE.md` rule and the
tsconfig comment are there so that it is not found twice.

## Punted / alternatives

- **Non-null assertions instead of the nested project.** About 120 of them
  in the hot loops plus six compound-assignment rewrites; the code would no
  longer be the JS.
- **`declare` fields** instead of `useDefineForClassFields: false`. The same
  emit, but a modifier on every field an agent would have to know to add.
- **Sharing `WAVE`, `ALGORITHMS` and the envelope curve.** #656. The shared
  modules will be read by the client project too, under its stricter check;
  the tables and builders take a few `!`, the hot paths stay here.
