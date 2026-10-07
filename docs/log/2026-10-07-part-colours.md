# Each part keeps a colour of its own

- **Date:** 2026-10-07
- **Status:** accepted (tacowars, 2026-10-07)
- **Links:** epic windsor#639 · the mockup
  `docs/research/2026-10-07-part-colours/mockup.html` · the Parts tab
  layout record `2026-10-03-parts-tab-layout` (the part strip) ·
  `2026-10-03-song-tab-one-frozen-column` (the number tab) ·
  `2026-10-05-group-automation-folder-tracks` (the group folders)

## Context

A part's colour comes from its sequencer kind (`LANE_TONE` in
`songViewTables.ts`): amber for Euclidean, teal for every other kind. The
part strip's chip edge, the number tab and the region blocks all read it.
A song of ten parts shows ten lanes in two colours, and the eye cannot
tell one pitched part from another at a glance.

tacowars asked for a colour per part, shared by its chip, its number tab
and its regions, with a swatch grid to pick another, and with the
console's own accents kept for the roles they already mark.

## Decision

1. **The colour is stored on the part, as `colour`: an integer index into
   the palette, 0 to 13.** It belongs to the document's part
   (`DocumentPart`), not the player's (`MusicPart`), since nothing that
   plays reads it. A part keeps its colour when other parts are added,
   removed or reordered. Two parts may share one, both by the picker and
   past the palette's 14 entries (a song holds up to 16 parts).
2. **The normaliser assigns a colour to every part without a valid one.**
   - An integer from 0 to 13 is kept.
   - An absent `colour` is assigned without a correction: a song written
     before this record carries none, and that is not damage.
   - Any other value is replaced, reported as a correction (for example
     `parts[2].colour: 31 is not a part colour 0–13 — assigned 4`).
   - Assignment runs once the whole part list is known. The valid
     colours are counted first. Then, in list order, each part without one
     takes the index the song's parts use least so far, ties going to the
     lowest index. A song with no colours therefore runs down the palette
     in order.
3. **A new part gets the colour used least.** The app's add writes no
   `colour`, so the normaliser assigns it by decision 2. In a song coloured
   by assignment alone, a removed part's colour is the first to come
   back. Once the picker has doubled colours up, the rule still gives the
   least-used colour with ties to the lowest index, which need not be
   the one just freed.
4. **No format bump.** The field is additive: a song without it loads,
   takes colours, and exports with them. Export writes `colour` on every
   part, and a round trip keeps it. `ARRANGEMENT_VERSION` is unchanged and
   there is no migration
   (`2026-09-28-format-versions-refuse-never-destroy`).
5. **The palette, in assignment order.** The app holds the hex values; the
   engine knows only the count (14).

   | # | Name | Hex | | # | Name | Hex |
   |---|---|---|---|---|---|---|
   | 0 | Sky | `#6EA8E2` | | 7 | Frost | `#E3DCE1` |
   | 1 | Lemon | `#EDE36E` | | 8 | Steel | `#5A7FBF` |
   | 2 | Raspberry | `#BC3D6D` | | 9 | Grass | `#669D42` |
   | 3 | Umber | `#8F7A55` | | 10 | Mint | `#9EE6A8` |
   | 4 | Aqua | `#6DE6FC` | | 11 | Blush | `#E2A2AA` |
   | 5 | Lime | `#77FB58` | | 12 | Periwinkle | `#A6AAF2` |
   | 6 | Magenta | `#D65FC6` | | 13 | Olive | `#ABBD3B` |

   Each entry sits as far as the palette allows from the three before it,
   so parts made one after another never look alike. The values were read
   from screenshots of Ableton Live's track colours (entries 0, 1, 3, 6,
   8, 10, 11 and 12, by eye) and its colour picker (the other six, as
   pixel values).
6. **The console's five accents are reserved and are never part colours:**
   amber `--carrier` `#E0A44E`, teal `--modulator` `#5FA8A0`, violet
   `--return` `#9C7BD0`, rose `--seq` `#CC7A9C` and orange-red `--hot`
   `#D2643C`. Every palette entry is at least 12 CIEDE2000 from each of
   them, computed from the hex values. The closest are Blush (12.4 from
   rose), Magenta (12.8 from rose) and Periwinkle (14.3 from violet). The
   first pass's Lavender, Indigo, Mauve, Teal, Orchid, Ochre and Tangerine
   fell under 12 and were dropped.
7. **Where the colour shows**, in place of today's tone by kind:
   - the chip's left edge in the part strip, and the row's edge in the ▾
     part list;
   - the number tab on the Song tab, and its tint down the part's open
     lanes;
   - the region block's border, its fill (the colour at 19% over the
     lane), and its ⟲ glyph, which today is always amber.
8. **Selection.**
   - The selected chip, and the ▾ list's current row, fill with the
     part's colour and take the dark ink `#14181A`, where today they
     fill amber.
   - The selected part's outline in the frozen column and its selected
     lane's border take the part's colour.
   - The selected region's ring is `--ink`, where today it is amber.
   - The harmony lane's selected chord keeps its amber ring.
9. **The picker.** Right-clicking a chip, or long-pressing it on touch,
   opens the picker. A long press is 450 ms, and moving more than 8 px
   cancels it.
   - The picker is a 7 × 2 grid of swatches in palette order, placed under
     the chip. The part's colour is ringed, and the name of the swatch
     under the pointer (or else the part's colour) shows below the grid.
   - One click sets the colour and closes the picker, as one undo step.
     Escape, a press outside, or scrolling closes it without a change.
   - A long press that opens the picker does not also select the chip.
     Picking a colour does not change the selection.
   - It works wherever the part strip shows.
10. **Group folders keep their Mixer accent**: teal, violet, amber in list
    order, then round again (`GROUP_ACCENTS`), for the folder tab, rail
    and outline.
11. **The sequencer device keeps its accent by kind** (`DEVICE_ACCENT`,
    `--kc`), and the cards' knobs keep `PERC_COLOR` / `PITCH_COLOR`. A
    violet part's sequencer would otherwise read as a return.
12. **Drums versus melodic by colour goes.** The chip still names the
    kind (`3 · Euclid`).

## Consequences

- The engine gains the field, its normalisation and the palette's count,
  and exports what the app needs through its index. The app gains the
  palette table beside `consoleColors.ts` and a test that holds its length
  to the engine's count.
- `LANE_TONE` then drives only the sequencer device's accent. The
  region's `.perc` class goes.
- The dark ink on a filled chip or number tab is under 4.5:1 on three
  entries: Raspberry 3.4:1, Umber 4.3:1 and Steel 4.4:1. The mockup was
  approved with dark ink on every colour, so it stays; a lighter ink on
  those three is a later tweak if they read poorly.
- The Mixer tab's strips do not take the part colour. That is a later
  change if wanted.
