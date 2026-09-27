# The plate's split keeps its methods, installed on the prototype

- Date: 2026-09-23
- Area: audio
- Links: issue #671 · epic #638 · records `2026-09-23-643-fm-worklet-is-generated-from-a-source-folder`, `2026-09-23-644-fm-worklet-leaf-units-are-modules`, `2026-09-23-645-voice-hot-paths-are-functions-over-the-voice`

## Decision

`worklet/reverb-processor.js` becomes `worklet/reverb/`, bundled to
`worklet/generated/reverb-processor.js` as the fourth `WORKLETS` row:

- `reverbConstants.ts` — the tunables and the delay and tap tables.
- `delayLines.ts` — `_makeDelay`, `_applySize`, `_read`, `_write1`,
  `_readTap`, `_readCubic`.
- `tank.ts` — `poleCoefficient`, `_writeInput`, `_renderBlock`.
- `reverbProcessor.ts` — the `DattorroReverb` class: the descriptors, the
  constructor, the load sampler, `_render`, `process`, the sleep methods, and
  `registerProcessor`.

The moved methods are functions with a `this: DattorroReverb` parameter,
assigned to `DattorroReverb.prototype` under the same names. The class
`declare`s them, so they emit nothing. Every call site (`this._read(…)`) and
every body is unchanged.

The gate went in first, in its own commit against the unmoved file:
`mixer/reverbGolden.test.ts`, with fifteen scenarios in three paths.

## Why

The ticket requires that no logic line changes. `worklet/CLAUDE.md` rule 6
makes the FM worklet's hot paths functions over the voice (#645). Doing the
same here would turn every `this.` into `plate.` in about 300 lines. That is a
rewrite, not a move, and it could change how V8 inlines the tank.

With functions on the prototype, both bundles print the same code lines after
esbuild. The only differences are the method headers (now `function`
headers), the eight prototype assignments, and one call that prettier joined
onto a single line. The PR attaches that multiset diff.

The class also keeps the sleep methods. They are short, they belong to the
processor's state machine, and `_renderAsleep` has to stay out of
`_renderBlock` for V8's sake (#547). That puts the entry module at about 330
lines, within the 350-line cap.

The sleep path is pinned by hash. The `sleep` and `sleep-and-wake` rows
assert that the plate slept, and their default hashes differ from the
`sleep: false` hashes. So the sleep path does not need a listening check to
stand in for a pin.

## Punted / alternatives

- Functions over the plate (`plate` as the first parameter, rule 6's shape):
  this belongs in its own ticket, with its own bench, if the plate ever needs
  the kernel treatment.
- Declaring every field with a type and `declare`-ing the prototype methods
  has no measured cost. The generated file carries no field initialisers
  (rule 7). This change took no bench reading, so none is claimed
  (invariant 3). The golden test is the gate.
