# Each part owns its patch

- **Date:** 2026-10-10
- **Status:** accepted (tacowars's direction on windsor#669: each part,
  whatever patch it plays, is isolated from every other part)
- **Links:** windsor#669 · `2026-09-28-format-versions-refuse-never-destroy`
  · `2026-09-27-user-library-in-indexeddb`

## Context

A part's `preset` names an entry in the song's `patches`, and a patch knob
writes into that entry. Two parts could name the same entry, so a knob
turned on one part changed the other. tacowars hit this in a song whose two
parts both played `ice-needle-copy`: the patch's Volume moved both parts,
and it went unnoticed for a while. The sharing came from `choosePreset`
(`packages/app/src/presetBrowser.ts`), which pointed the part at the song's
existing copy when the picked id was already in `patches`.

## Decisions

1. **The invariant.** In the open song, no two parts play the same
   `patches` id. Every path that sets a part's patch keeps it: the patch
   bar's picker and ◀ ▶ step buttons, the patch browser's Load into, Save
   as…, Init (already one id per slot), Rename, and every way a song opens
   (import, restore, a stored song).
2. **Load.** Choosing patch `id` for slot S when no other part plays `id`
   is unchanged. When another part plays `id`, S gets a copy under
   `uniqueId(id, [...library ids, ...song ids])` (`patchMetadata.ts`). The
   copy holds the same sound the pick loaded before
   (`documentPatch ?? libraryPatch`). Only the id is new. The patch's
   display name is unchanged, and the load stays one undo step.
3. **Library link: `patchSource`.** `DocumentPart` gets an optional
   `patchSource?: string`: the library id this part's copy came from. It is
   set only when the part's `preset` differs from that library id. The
   engine's normaliser keeps a non-empty string, and drops anything else
   with a report, the way it handles the part's other optional fields. It
   round-trips through export and import. The field is additive, and its
   absence reproduces the old behaviour, so `ARRANGEMENT_VERSION` does not
   change. Nothing that plays reads it: `AudioSystem.apply` takes it out of
   a live partial before the player's merge, as it does a part's
   `automation`, so setting or clearing it is never reported as an unknown
   field.
4. **Origin, Save and the modified marker.** `patchOrigin` looks the
   library up by `part.patchSource ?? part.preset`. Save writes that
   library entry and updates only this part's song copy
   (`patches[part.preset]`), never another part's. The modified dot's
   baseline is that library entry, and a confirmed discard and Revert to
   library write the entry into this part's copy only. Save as… is
   unchanged: this part switches to a new unique id, with no
   `patchSource`, because the new id is a library id. When the library
   entry is deleted, the origin falls back to `document`, as before.
5. **Opening a song splits sharing.** For each id played by more than one
   part, the lowest slot keeps the id. Every other part gets an identical
   copy under a fresh `uniqueId`, and its `patchSource` is set as follows:
   - the part's existing `patchSource`, if it has one;
   - otherwise the shared id, if that id is a library id;
   - otherwise absent.

   This is a pure function, `isolatePartPatches` in
   `packages/app/src/partPatchIsolation.ts`, applied in
   `AppContext.replaceDocument`'s open amend beside `loadRenames`, so it is
   a document edit made on open in the same way. Part names do not change.
   The split never deletes a patch: a song's unplayed copies stay. A load
   that copies (decision 2) takes its `patchSource` by the same rule, from
   the part it copies.
6. **The engine stays permissive.** The engine still plays a document where
   parts share an id. The invariant belongs to the app's edits and its open
   path. Apart from `patchSource`, the engine does not change.
7. **Rename.** Rename keeps working as before; it now moves only one part,
   and it keeps `patchSource`. The browser's Rename tooltip for a song copy
   reads "Rename the song's copy; the part playing it follows".

## Consequences

- A part playing its own copy steps ◀ ▶ from its library entry's place in
  the listing, not from the head of the song's own patches, where the copy's
  fresh id would otherwise list it. Its patch box shows the library
  entry's category.
- Stepping a part through a patch another part plays leaves a copy in the
  song for each step that lands there, as a pick always left the library
  patch it embedded. Unplayed copies are kept (decision 5), so they list
  under "this song" until the song's Delete removes them.

## Addendum: an unedited automatic copy goes when its part moves on (windsor#671)

Stepping a part through a patch another part plays left a copy behind on
every pass (Consequences above). tacowars's direction: a copy the part
never edited is deleted when the part moves on. The pure function is
`leftCopyDrop` in `packages/app/src/partCopyCleanup.ts`.

1. **When.** Whenever a part's `preset` changes away from id `P` through
   the picker, ◀ ▶, the browser's Load into (all `choosePreset`), Save as…
   (`copyToNew`) or Init (`initPatch`). The removal rides in the same
   `ctx.change` as the move, so it is the same undo step, and undo brings
   the copy back together with the part's old `preset`. Rename removes the
   old id itself and needs no check.
2. **What is dropped.** `P` leaves `patches` only when all of these hold:
   - no other part plays `P`;
   - `P` is not a library id, and not an Init sentinel (`dropInit` owns
     those);
   - `P` is an automatic copy: its id is exactly `<base>-<n>`, n from 2,
     the id `uniqueId` gives a copy of `<base>`, where `<base>` is the
     copy's own base. That is the part's `patchSource` when it has one;
     with none (the open-time split and a load's copy of a song-only
     patch), it is an id still in the song's `patches`. A renamed copy has
     lost its base's shape, so a rename keeps it even where the display
     name did not change, and even when the new id looks like a copy:
     `custom-2` on a part linked to `bell` is no automatic copy;
   - `P` is leaf-identical (`patchLeafDifferences` empty, the name
     included) to its base: with a `patchSource`, that library entry or
     another patch already in the song; with none, the song patch `<base>`
     itself. The patch the move loads is no witness: Save as…
     writes the part's edits into its new patch, and the copy holding the
     same edits stays, as any edited copy does.

   Deleting it therefore loses no sound.
3. **Never dropped:** a patch another part still plays, a library id
   (which includes everything Save as… made), an edited or renamed copy,
   and an unplayed song patch no part just left. A song that opens with
   orphaned copies keeps them.
4. **A rename keeps the library link** (windsor#671 decision 5; amends
   decision 7). Renaming a song copy off a library id, when the part
   playing it has no `patchSource`, sets `patchSource` to that old id, so
   Save, Revert and the modified marker still reach the library entry. A
   part that already has `patchSource` keeps it, and a copy whose old id
   is no library id gets none. This holds for the patch bar's Rename and the browser's,
   which share `renamePatch` (`packages/app/src/patchLibrary.ts`).

No format change: nothing new is stored, and `ARRANGEMENT_VERSION` stays.
