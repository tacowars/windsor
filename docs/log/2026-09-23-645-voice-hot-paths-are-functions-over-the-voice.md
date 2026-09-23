# The voice's hot paths are functions over the voice

- Date: 2026-09-23
- Area: audio
- Links: issue #645 · epic #638 · builds on `2026-09-23-644-fm-worklet-leaf-units-are-modules` · the plan `2026-09-23-638-worklet-refactor-optimised-for-agents` · `2026-09-15-fm-voice-kernel-fixed-index-bit-identical` (the kernel this moves) · reading `docs/research/2026-09-23-645-voice-split-bench/`

## Decision

`Voice` is `worklet/fm/voice.js`: its state and lifecycle. Its hot paths are
functions that take the voice as their first parameter, in three modules:
`voiceControl.js` (`bindVoiceConstants`, `updateVoiceControl`),
`voiceRender.js` (`renderVoiceGeneric`) and `voiceKernel.js`
(`renderVoiceKernel`, with `storeOperator` private to it). The entry,
`fmProcessor.js`, is the part processor alone. Bit-identical: the golden
table (#643) passed unchanged, and every code line of the four modules is a
line of the original with `this.` read as `voice.`.

1. **`render` and `updateControl` stay methods and delegate.** The part
   calls `v.render(…)` and `v.updateControl(…)`; `fmProcessorDormancy.test.ts`
   wraps `voice.render` to count calls and `fmProcessorKernel.test.ts` calls
   it directly. The methods are three lines each: `render` chooses the kernel
   or the generic loop, as its first four lines did before. One extra call per
   render chunk and per control block is the whole cost, and the bench read
   it as noise (−0.3 % on the #548 scenario, below).
2. **The receiver is a parameter, not `this`.** `this.x` became `voice.x`
   throughout; `this.storeOperator(…)` became `storeOperator(voice, …)`. The
   arithmetic, its order and every `Math.fround` are as they were, which is
   what bit-identity by construction requires and what a purity check
   confirmed line by line (889 code lines, the only differences the removed
   dispatch and the three delegates).
3. **The kernel is one function and stays one.** Its module header says so
   and why (#548's research): a helper per operator would reload the locals
   through the voice and give the saving back. The `max-lines-per-function`
   disable moved with it, still reasoned.
4. **`Voice` left the entry.** The ticket asked for the three modules; with
   them out, `Voice` and the processor together were still 800 lines, past
   the 1.5× line where CLAUDE.md says a file is a split, so `voice.js` is its
   own module and the entry holds the processor only (455 lines, no
   `max-lines` disable needed).
5. **Names.** The module functions carry `Voice` in their names
   (`renderVoiceKernel`, not `renderKernel`) so that a grep for the method
   name finds the method and a grep for the function finds the function, and
   the harness's top-level namespace stays unambiguous.

## Why

The plan's item 4 for the most sensitive step: per-render-call granularity,
the kernel in one file read top to bottom, each module opening with its
contract. The reading (`docs/research/2026-09-23-645-voice-split-bench/`,
laptop, indicative): 182.7 ms before, 182.1 ms after on the #548 scenario,
per part within ±1.1 %. The ticket's line was 5 %.

## Punted / alternatives

- **Calling the module functions from the part directly** (no delegates).
  Would save the delegate call and break the two tests that reach `render`
  on the voice, for a cost the bench cannot see.
- **A `VoiceState` object separate from the class.** The class already is
  the state; a second shape would be an abstraction for its own sake.
- **TypeScript and direct per-module tests.** #654.
