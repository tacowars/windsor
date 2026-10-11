# A wet-path slot: one child insert inside a host insert

- **Date:** 2026-10-11
- **Status:** accepted (tacowars's decisions of 2026-10-11 on epic windsor#686)
- **Links:** windsor#686 (epic) · windsor#687 (E1, the seam) · windsor#688
  (E2, audio) · windsor#689 (the mockup)

## Context

Some inserts mix a wet layer back into their dry signal: Echo today, and
later bloom, a delay or a reverb. That wet layer can only be shaped by the
host's own controls. Windsor has few send buses and no parallel racks, so
there is no way to put a chorus or a filter on Echo's repeats alone. The
design was drafted in the cloudburst study, with bloom as its host; this
record is Windsor's version.

## Decisions

The epic's decisions, which bind every child ticket:

1. **Generic.** A kind is a **host** when its `fields` include `slot`. Echo
   is the first host: its graph already has a native wet node, so it needs
   no worklet change. bloom adopts the contract when it is ported. Delay,
   Plate and Retro Reverb mix inside their worklets, so each is a later
   ticket of its own.
2. **One level deep.** A host can't hold its own kind, and a child's own
   `slot` is forced to none.
3. **The child's Mix is a normal control**, neither pinned nor hidden. A
   phaser pinned at Mix 1 outputs only its all-pass path and has no
   notches.
4. **Swaps crossfade.** On a kind change, an arrival or a removal, the old
   child ramps out while the new one ramps in over the same
   `INSERT_FADE_SECONDS` window, with no silent gap. tacowars confirms this
   by ear (E2).
5. **`route(on)` crosses only the host's internal wet edge.** The slot
   module fades each child's own gain.
6. **Automation targets** are `insert.<hostId>.slot.<field>`, with rows
   from the live child kind. A child kind change drops the `slot.*` lanes,
   in the same undo step (E3).
7. **The song schema is additive.** `slot?: InsertSpec | null`; absent or
   null reads as none. `ARRANGEMENT_VERSION` does not move, and a song
   saved before the slot opens unchanged.
8. **v1 slot limits:** a child compressor's sidechain is forced to
   `internal`, an EQ child has no spectrum and no Listen (E3), and the child
   doesn't count toward `MAX_INSERTS`.
9. **The card** is variant A, inline with the child foldable to its rail,
   drawn for Echo in a mockup tacowars approves before the card ticket is
   written.

What the seam (windsor#687) settled in code:

10. **The registry reads the slot, never the host's kind.**
    `normaliseInsertEntry(entry, at, n, registry)` normalises one entry, its
    id apart. For a host it takes `slot` out before the kind's `normalise`
    and reads it after: absent or null is none, silently; a non-object is
    none, reported; the host's own kind is refused, reported; a kind the
    registry lacks is dangling and dropped to none. A kept child is
    normalised by the same function at `<at>.slot`. A host kind's own
    `normalise` returns `slot: null`, so a normalised host always carries
    the key and an exported Echo writes `"slot": null`.
    `normaliseInserts` keeps the list rules: not a list, `MAX_INSERTS`, and
    the ids over the list.
11. **A child's id** comes from a one-entry `chainIds`: filled silently
    when absent, replaced with a correction when invalid. It may equal its
    host's id or any other strip id, because every target spells it under
    its host's.
12. **The host contract types** are `WetPath` and `InsertStage.wetPath`
    (`inserts/insertKind.ts`): where the wet layer leaves (`send`), where
    the child's output comes back (`ret`), and `route(on)`. No stage
    implements them until E2.
13. **The slot rows.** `slotRows(host)` gives every kind other than the
    host its rows, its switch included, as `slot.<target>` labelled
    `Slot <label>`, each carrying `childKind` and available only while the
    slot holds that kind and the child's own row is read on the child's
    spec. Echo's table entry is its own rows and then these. So
    `automatableInsertFields` on an Echo lists the live child's readable
    rows and nothing for an empty slot.
14. **The row lookup takes the insert's spec.** `insertTargetRow(spec,
    field)` and `targetRow`'s `insertSpecOf` callback replace the kind, since
    `slot.rate` is a row once per child kind. A lane on a slot field the
    live child lacks, or on an empty slot, is dropped on load with the
    existing "has no automatable" correction.

## Consequences

- An insert id that itself ends in `.slot` now spells its own fields
  escaped (`insert.x%2Eslot.mix`), because `insert.x.slot.mix` reads as
  `x`'s `slot.mix`. A generated id never holds a dot; a hand-written song
  with such a lane loses it with a correction.
- Nothing plays the child until E2, and nothing creates one in the UI until
  E3. A song holding a child normalises, round-trips and keeps the child's
  id now.
