# Operator start phase and the pitch envelope's advanced controls

- **Date:** 2026-09-30
- **Status:** proposed (awaiting tacowars's look in the PR preview)

## Context

The kick refit (`2026-09-30-drum-kicks-fitted-to-recordings`) relies on
three patch fields the console could not edit: an operator's `phaseFree` and
`phase`, and the pitch envelope's Init, Peak, End and curves, plus its loop
mode. They could be reached only through the Patch JSON dialog.

## Decisions

1. **An operator's Start is a segment in its bay's Adv row: Free | Locked.**
   Free is `phaseFree: true`, the engine's default; Locked is `false`. The
   rule is `operatorStart.ts`, pure and tested.
2. **The Phase knob shows only while Locked.** It edits `ops.<i>.phase`,
   0..1 of a cycle, printed in degrees (`fmtCycleDegrees`). Free ignores the
   field, so a knob that does nothing stays out of the way.
3. **The Pitch Env section shows the advanced row and the Envelope Loop
   picker all the time,** as the Filter Env section shows its advanced row.
   The row is `PITCH_ENV_ADV_KNOBS`: `ENVELOPE_ADV_KNOBS` without Key,
   because the voice never key-scales the pitch envelope
   (`voice.ts` sets its time scale to 1). `allPatchKnobs` walks the same
   table, so no Key knob is expected there.
4. **One loop picker for every envelope.** The bays' picker moved to
   `envelopeKnobs.ts` as `envLoopPicker(editor, path, color)`; the pitch
   envelope uses it too. The filter envelope's loop mode stays unexposed; no
   request has asked for it.

## Consequences

- Every field the fitted kicks use is now editable in the console.
- No format change: the fields already existed and round-tripped.
