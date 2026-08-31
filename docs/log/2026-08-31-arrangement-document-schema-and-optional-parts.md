# Arrangement documents: optional part slots, parts drop rather than default, mix overlay in the document

- Date: 2026-08-31
- Links: issue #75 · implements
  `2026-08-31-arrangement-console-and-runtime-arrangements` §3–§5 · builds on
  `2026-08-31-generative-sequencing-transport-and-pitch` and
  `2026-08-31-mixer-sends-returns-and-channel-strips`

The console/arrangements record decided *that* an arrangement is a committed
JSON document with a never-throws normaliser, a metronome fallback and a
verify gate. It did not pin the document's schema. These are the schema
decisions made while implementing #75; #70b (the console) writes documents
against them.

## Decision

1. **The four part slots (`kick`, `hat`, `arp`, `drone`) are optional, end to
   end.** `Arrangement` makes them optional, `ArrangementPlayer` builds only
   the generators for the parts present, and `AudioSystem.initMusic` creates
   only those parts. A partial arrangement plays its parts and nothing else;
   a partial naming an absent slot in a live `apply` is ignored and reported
   (a part that was never initialised has no `AudioPart` and cannot be added
   live).

2. **A part that cannot play is dropped, never defaulted.** A preset
   deliberately has no default: a part invented by the normaliser is exactly
   the invisible musical stand-in the parent record's §4 rejects. Absent
   *fields inside* a present part take defaults (from the generators' own
   `DEFAULT_*_CONFIG`s) silently; junk values are replaced with a correction.
   When no part survives, the document is unusable and the metronome
   fallback plays.

3. **The fallback is expressible inside the ordinary schema** because of (1):
   `FALLBACK_ARRANGEMENT` is one percussion slot on a quarter-note pulse with
   `pulses.min === max === steps` (E(4,4), nothing for the density LFO to
   modulate, no RNG consumed — not generative), part name `click`, which is
   deliberately **not** a `MIX` strip so it routes through `DEFAULT_STRIP` —
   unity, centred, no sends — whatever the shipped mix says.

4. **The document may carry a `mix` section**: per-part strip overlays
   (`level`, `pan`, `sends`) applied over the code's `MIX` at part creation
   and through `AudioSystem.apply` live. This is where a document can name a
   return, which the dangling-name gate requires ("a return the document
   mentions and the code does not define"). Sends overlay the base per
   return — set a send to 0 to silence it — the same only-named-fields
   semantics the live `apply` path uses.

5. **Dangling names are a separate report from corrections.**
   `makeArrangement` returns `{ document, corrections, dangling, usable }`;
   the gate predicate is `isShippable` = usable ∧ no dangling. A dangling
   preset drops its part (the player would throw on it); a dangling part or
   return name still plays (via `DEFAULT_STRIP` / a dropped send) but fails
   the gate. The gate test additionally requires `corrections === []` on the
   committed document — slightly stricter than the parent record demands —
   because the committed file is normalised output (the console exports
   normalised documents), so any correction on it means the file drifted
   from what actually plays.

6. **The verify gate is a vitest test** (`arrangementGate.test.ts`), not a
   script: it already runs inside `npm run verify` (typechecked by
   `tsconfig.test.json`, executed by `npm run test`) and imports the
   committed JSON exactly the way the game does — same resolver, same JSON
   semantics — so there is no second loader to drift.

## Why

The through-line from the parent record is "no musical value may appear that
nobody wrote". Optional slots are what make that structural: the alternative
— required slots with "silent" or velocity-zero placeholder parts — either
invents musical data (rejected by §4) or invents a second way of being
absent. Dropping unplayable parts keeps `makeArrangement`'s contract honest
(everything it returns constructs without throwing) without inventing
content: the part the author wrote is gone, the report says so, and the gate
stops it shipping.

## Punted / alternatives

| Rejected | Why not |
|---|---|
| Required slots with a `enabled: false` or velocity-0 stand-in | A second way of being absent, and the stand-in is authored by nobody |
| Defaulting a missing preset to something audible | The §4 invisibility objection verbatim |
| `returns`/`spaces` sections in the document | Nothing existing reads them; #70b's Mixer tab can add them when the console needs to author returns |
| A separate gate script under `scripts/` | A second JSON loader with its own resolution semantics, plus new verify wiring, for no added coverage |
| Wholesale sends replacement in the document's mix overlay | Would make the document and live-apply semantics differ for the same section |
