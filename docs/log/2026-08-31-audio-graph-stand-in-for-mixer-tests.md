# The mixer is tested on an in-repo graph stand-in, not a Node Web Audio dependency

- Date: 2026-08-31
- Links: issue #68 · implements
  `docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md` ·
  same approach as `packages/client/src/audio/__fixtures__/workletHarness.ts`
  and `reverbHarness.ts` (#33, #52)

## Decision

The sends, returns and pan rotation of #68 are asserted on headless renders
under vitest, using a block-rate stand-in for the native Web Audio nodes the
routing is built from: `packages/client/src/audio/__fixtures__/fakeAudioNodes.ts`
(gain, splitter, merger, delay, biquad, a pass-through compressor) and
`fakeAudioContext.ts` (the factories, the worklet module registry, a global
`AudioWorkletNode` that instantiates the real `reverb-processor.js` through
`reverbHarness.ts` or a test-fed source, and the block loop). `FmEngine` and
`AudioSystem` run on it unchanged.

No dependency is added. The stand-in is a test fixture, excluded from the
client build like the two harnesses before it, and typechecked by the new
`packages/client/tsconfig.test.json`.

## Why

The acceptance criteria ask for offline-render assertions -- two parts on one
return at different amounts, a send at zero leaving another part's tail alone,
sends unmoved by pan, energy preserved under a hard pan -- and there is no
`OfflineAudioContext` in Node. The brief's pointer to `offlineRender.ts` did not
resolve: that module is the browser-side patch baker and needs a real context.

Three ways to get a render were on the table:

1. **A Node Web Audio implementation** (`node-web-audio-api`, a Rust binding).
   It would render the real graph, but it is a native binary dependency added
   to the PR gate for one package's tests, its `AudioWorklet` support has its
   own semantics to verify, and the repo's stated rule for DSP testing is
   already "shim the scope, drive the block loop".
2. **Playwright against a real browser.** The most faithful, but `npm run e2e`
   is outside `npm run verify`, so the mixer's invariants would not gate a PR,
   and a WebGPU browser is the wrong tool for a linear-algebra assertion.
3. **A stand-in for the six node types the routing uses.** The graph around
   the DSP is small and linear: a gain multiplies, a splitter and merger move
   channels, a delay reads what was written `delayTime` ago, a biquad is the
   spec's RBJ section. Those are a few hundred lines, deterministic,
   in-process, and fast (the whole suite renders in under a second).

Option 3 keeps the plate real -- the return runs the actual
`reverb-processor.js`, so tails and their independence are the DSP's, not a
model of it -- and confines the modelling to arithmetic the spec defines
exactly. The stand-in says what it is not: the compressor passes through,
parameters step at block boundaries, and a delay must be at least one render
quantum (which a real feedback cycle requires anyway).

The browser evidence a `scope:client` PR carries still comes from a real
Chrome (`docs/research/2026-08-31-68-audio-mixer-sends/`); that proves the
graph constructs and the page stays clean, not the numbers.

## Punted / alternatives

- **`node-web-audio-api` as a dev dependency.** Punted, not refused: if a
  later ticket needs the browser's own `DynamicsCompressorNode`,
  `StereoPannerNode` or a-rate automation under test, the stand-in is the
  wrong tool and this is the next one to reach for.
- **Extending the stand-in to model the compressor.** Not needed by anything
  asserted; a model of a limiter that nobody has measured would be a second
  unmeasured thing.
- **Running the real `fm-processor.js` as the part source.** The fixture
  plays a test-supplied `Feed` instead, multiplied by the `gain` param as the
  worklet does, because the assertions need a known signal (two tones, a
  burst), not a preset. The processor is covered by `fmProcessor.test.ts`.
