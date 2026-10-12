# Accents and ratchets on Roll notes

- **Date:** 2026-10-12
- **Status:** accepted (decisions agreed with tacowars on 2026-10-11 and
  2026-10-12; tacowars approved the mockup on 2026-10-12)
- **Links:** this record's issue, windsor#751 · the discussion on windsor#735 (closed: mod-wheel and
  pitch-bend lanes are dropped) · the mockup,
  `docs/research/2026-10-11-roll-accent-ratchet-mockup/mockup.html` · the
  Roll record `2026-10-04-roll-sequencer` · `2026-10-11-bounce-to-roll`,
  which this record amends · ratchets in
  `2026-10-01-sequencer-rack-devices` decision 6 · recording in
  `2026-10-09-roll-recording` · format rules in
  `2026-09-28-format-versions-refuse-never-destroy`

## Context

A Grid, Arp, Euclid or Figure step can carry an accent and a ratchet. A
Roll note can carry neither, so Bounce to Roll (shipped in #744, #745 and
#747) loses both. It drops an accent's mod and raises the part's Vel to fit
the accent's velocity bump. It writes a ratchet's hits as separate notes
rounded to 24 PPQ, which can lose a hit. The toast counts each loss.

windsor#735 proposed mod-wheel and pitch-bend lanes partly to carry the
accent's mod. tacowars preferred to put accents and ratchets on the note
itself. With that, the lanes have no demand and #735 is closed.

## Decisions

1. **Per note.** `RollNote` gains two optional fields:
   - `accent: true`. Absent means not accented.
   - `ratchet`: a whole number from 2 to `RATCHET_MAX` (4). Absent means 1.

   The normaliser writes `accent: false` and `ratchet: 1` as no key, so a
   plain note is written exactly as before.
2. **The roll's accent amounts.** `RollSequencerConfig` gains
   `accentVelocity` and `accentMod`, each 0..1, one pair per roll, as the
   Grid has. Absent means the Grid's defaults, `ACCENT_VELOCITY_DEFAULT`
   (0.2) and `ACCENT_MOD_DEFAULT` (1). The normaliser writes a default as no
   key.
3. **What an accent plays.** An accented note plays as a Grid accent plays,
   through `partNoteOn`:
   - its velocity is the note's velocity × the part's Vel + `accentVelocity`,
     at most 1;
   - it adds `accentMod` to the wheel for that voice alone
     (`NoteExtras.mod`, #602).

   The note's own `velocity` is left as drawn.
4. **What a ratchet plays.** A ratchet of N plays N hits, spaced evenly in
   time across the note's length, through the engine's ratchet roll
   (`rollHits`) with the note's length in ticks as the span. The hits follow
   the Grid's rule:
   - Hit 0 is the note's own note-on, slide and all.
   - Each later hit is the previous hit's note-off, then a note-on that
     carries the note's accent and no slide.
   - The last hit is held to the note's end, so slide by overlap into the
     next note works as before.

   The hits are timed in seconds, under the song's swing, so nothing is
   rounded to the 24 PPQ grid.
5. **Monophonic only.** Accents and ratchets are for single lines; the Chord
   sequencer has neither. The normaliser clears `accent` and `ratchet` from
   every note that shares its onset tick with another note, and reports it
   as a correction. Every write goes through the normaliser, including a
   drawn note, a move, Quantise, a recorded take and a bounce. The lane
   draws no cell for such a note.
6. **The shortest ratchet.** A note shorter than a 1/32 (3 ticks at 24 PPQ,
   `ROLL_RATCHET_MIN_TICKS`) takes no ratchet. Its Rat cell is drawn
   disabled. The normaliser clears a ratchet from a shorter note, for
   example after a resize, and reports it.
7. **The lane.** The corner under the keys that reads `VEL` today becomes
   three stacked tabs, **Vel · Acc · Rat**, choosing what the lane under the
   notes shows. The choice belongs to the view, as Notes · Envelopes does,
   and is never written to the song.
   - **Vel** is today's stems, unchanged.
   - **Acc** draws one square under each note's onset, the Grid's A cell,
     lit in the note's colour when accented. A click toggles it.
   - **Rat** draws one cell under each note, as wide as the note, holding
     its count and one bar per hit. A click steps ×1 → ×2 → ×3 → ×4 → ×1;
     shift-click steps back.
   - With notes selected, a click on one of their cells sets all of them to
     the clicked cell's new state.
   - One click is one undo step.
8. **Marks on the notes.** Whatever the lane shows, an accented note has a
   white top edge and a ratcheted note is split into its hits.
9. **The Velocity row.** **Vel** moves from the top of the Notes page's
   second control column into a row under both columns, beside the new
   **Acc vel** and **Acc mod**: the Grid's three. The Roll device is short
   of width, so the row adds height instead. The Roll device takes 284 px
   where every sequencer device takes `SEQUENCER_DEVICE_H_PX` (244) today,
   through a Roll-only height; the other devices are unchanged.
10. **Recording.** A recorded note is plain. A hard-played note records
    its velocity, never an accent. Quantise moves a note with its accent and
    ratchet, and decision 5 applies where two notes land on one tick.
11. **Bounce to Roll.** The render writes what the generator played:
    - An accented step writes `accent: true`. The bounce copies the
      generator's Acc vel and Acc mod onto the roll, and the note's
      velocity is the event's own, with no bump. The part's Vel is kept,
      not raised.
    - A ratcheted step writes one note with its `ratchet`, where that note
      plays the same hits: its length is the ratchet's span, and each hit
      is held to the next. Where it would not (a tie past the step, an Arp
      gate under 1, a Euclid hold shorter than the spacing), the bounce
      writes the hits as notes, as today. The render's parity test
      (`bounceRenderParity.test.ts`) holds both cases.
    - Decision 5 applies to the bounced notes, as to any write.
    - The toast loses "accents lost their mod" and "ratchet hits lost"
      except in that fallback. "Ticks rounded" counts only the fallback's
      ratchets and the cases it counts today that are not ratchets.

    This supersedes those parts of `2026-10-11-bounce-to-roll` decisions 4
    and 8. That record is left as it is.
12. **No format change.** The fields are additive, and their absence plays
    as today, so `ARRANGEMENT_VERSION` is not bumped
    (`2026-09-28-format-versions-refuse-never-destroy`).

## The mockup

Today's Roll device holding the bounced Acid Saw bar from the bounce
record's worked example, with ratchets added on steps 9 (×2) and 16 (×4).
Its toolbar switches the lane between Vel, Acc and Rat. Its cells respond,
and the notes and the summary line follow. Dashed outlines mark what is
new.

## Consequences

- Build tickets, written now the mockup is approved:
  1. The format and engine: the two note fields and the roll's two
     amounts, the normaliser's rules (decisions 5 and 6), the accent and
     ratchet in the Roll's playback, and the engine index.
  2. The Notes page: the lane switch, the Acc and Rat lanes, the marks on
     the notes and the Velocity row.
  3. Bounce to Roll: accents and ratchets onto the notes, and the toast.
- An older build reading a song with these fields drops them. The format
  rules accept that for an additive field.
- windsor#735's lanes are not built. Recording pitch bend and the mod
  wheel stays in the recording record's "Later" list.
