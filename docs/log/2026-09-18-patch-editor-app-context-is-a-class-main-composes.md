# The console's app context is a class; main.ts composes

- Date: 2026-09-18
- Area: audio
- Links: issue #620 · epic #622 · root `CLAUDE.md` "Code structure" · record `2026-08-31-arrangement-console-and-runtime-arrangements`

## Decision

The arrangement console's `AppCtx` implementation lives in
`tools/patch-editor/src/appContext.ts` as the `AppContext` class over the
engine host, the document model and a status line; `main.ts` constructs the
systems (model, host, context, keyboard, MIDI) and wires them (the tab shell,
the power button, the pump timer, the library boot) and holds no behaviour of
its own. The `AppCtx` interface in `context.ts` keeps its names — `change`,
`restructure`, `importDoc`, `capture`, `release`, `render`, `status`, `host`,
`model` — and gains `parts`, the `PartsSession` the context owns (decision 3 of
the ticket): the working patch, the selection and the live part, with the
document commit a constructor parameter rather than a module hook a tab
reassigns. `patchState.ts` is gone; its path helpers are `patchPath.ts`, and a
Parts-tab control is handed a `PatchEditor` (patch, push, refresh) built once
per render by `partsTab.ts`.

## Why

Root `CLAUDE.md` says a composition file constructs and wires and contains no
game logic. `main.ts` held the merge ordering, the refusal and ignored status
text, the capture and release messages and a build-then-render sequence
duplicated between `restructure` and `importDoc` — the console's core rules,
untestable without a browser because they were closures over a page. As a
class over the host and the model they test with fakes (`appContext.test.ts`),
and the cards and panels see the same `ctx` surface, so a parallel ticket
(#619) rebases mechanically. The module singletons in `patchState.ts` made
every tab's correctness depend on which tab rendered last, because
`hooks.refresh`, `hooks.commit` and `hooks.afterCommit` were reassigned inside
`renderPartsTab`; a session the context owns and an editor the tab builds make
the dependency explicit and the tests plain objects instead of save-and-restore
dances around module state.

## Punted / alternatives

A generic host interface on `AppCtx` (so a fake needs no cast) was not done:
the cards read `ctx.host.part`, `ctx.host.analyser` and `ctx.host.enabled`, and
narrowing the type would have touched files this ticket does not own. The
test casts a typed `ContextHost` fake once.
