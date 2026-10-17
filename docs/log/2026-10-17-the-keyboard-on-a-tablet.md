# The audition keyboard on a tablet: a touch-sized row, slides, a strike velocity and an expanded view

- **Date:** 2026-10-17
- **Status:** proposed, accepted when tacowars approves the mockup.
- **Mockup:** `docs/design/tablet-keyboard-mockup.html`, with its frames
  rendered as `docs/design/tablet-keyboard-today-*.jpg` and
  `docs/design/tablet-keyboard-proposed-*.jpg`. Its "Today" frames
  reproduce main's Parts tab at 1024 × 1366, 1366 × 1024, 1440 × 900 and
  390 × 844.
- **Links:** this record's issue, windsor#861 · per-pointer notes,
  windsor#859 · the keys' `touch-action`, windsor#857 · the build,
  windsor#863 (Keyboard 1/2) and windsor#864 (Keyboard 2/2) · the expanded
  views, #851, #855 and #856 · the phone's breakpoint
  `2026-10-04-phone-header` · touch sizing in the context menu
  `2026-10-16-song-tab-context-menu` · the Roll's tap
  `2026-10-09-roll-recording` · the harmony card's held chord
  `2026-10-02-harmony-card-audition`

## Context

The audition keyboard (`Keyboard`, `packages/app/src/keyboard.ts`) is a row
of 24 keys at the foot of the Parts tab, 46 px high, beside Oct −, the
octave label, Oct +, Hold, Panic and the MIDI selector. On the desktop it is
a way to hear a patch next to a MIDI controller. On a tablet it is the only
instrument there is, and it is not built for fingers:

- **The keys are narrow.** The black keys sit inline at 0.62 of a white
  key's flex, so in a headless browser with a real song a white key is
  26.1 px wide at 1024 × 1366, 43 px at 1366 × 1024 and 15.3 px at
  390 × 844 (46.7 px at 1440 × 900). The app's touch row is 44 px
  (`contextMenuTables.ts`, `touch.rowPx`).
- **A chord sticks.** Every pointer press is filed under the one source
  `mouse`, so a second finger overwrites the first's entry: lifting either
  stops only the last note, and the first rings on until Panic
  (windsor#859).
- **A finger can't slide.** Each key captures its own pointer, so a finger
  that moves along the row keeps its first key.
- **Every strike is 0.9** (`FIXED_VELOCITY`), so a drum or a pad played by
  hand has no dynamics.

The harmony card's ▶ (`2026-10-02-harmony-card-audition`) already holds a
whole chord under one finger; this record makes the keyboard the
instrument that plays one finger per note.

## Decision

1. **Three keyboards from one component.** `Keyboard` keeps playing the
   selected part through `part.noteOn` / `noteOff`, with its QWERTY keys,
   its MIDI sinks, Hold, Panic and the Roll's tap
   (`2026-10-09-roll-recording`). What changes is how the keys are laid out
   and what a touch means:
   - (a) the desktop keys row stays as today, plus one button (decision 9);
   - (b) the keys row on a touch device is sized for fingers (decision 4);
   - (c) an expanded keyboard view fills the window (decisions 7 and 8).

   Nothing a QWERTY or MIDI player does changes.
2. **Polyphony is the engine's.** A music part sounds at most 12 voices
   (`MUSIC_PART_MAX_VOICES`, `packages/engine/src/audioConstants.ts`, which
   `musicRoster.ts` passes to every part). A note that would make a
   thirteenth steals one (`allocateVoice`, `worklet/fm/voiceAllocation.ts`):
   a dormant voice first when dormancy is on, else the quietest released
   voice still sounding, else the oldest held one, which fades out over
   30 ms (`STEAL_FADE_SECONDS`, `stealVoice` in `voiceSteal.ts`) while the
   new note takes a reserve slot. A patch with `spread` above 0 starts two
   voices a note (`fmProcessor.ts`), so it steals at its seventh held note.
   A mono patch (`patch.mono`) plays its newest note and cuts the one
   before (`cutSounding`, `fmProcessor.ts`). The only other ceiling is the
   device's touch count, `navigator.maxTouchPoints`; this record quotes no
   number for any device. No new cap, and no measurement claim.
3. **Every note is its own pointer, and the keys take the touch.** A
   pointer press is filed under its own source and lifted by it
   (windsor#859, `pointer:<pointerId>`); a key already held by another
   pointer takes no second one. The keys carry `touch-action: none`
   (windsor#857), so a finger that lingers or slides plays and never
   scrolls. Both are the build's prerequisites.
4. **The keys row sized for touch.** When the primary pointer is coarse,
   `@media (pointer: coarse)`, the Parts tab's keys row is laid out for
   fingers. A media query, where the context menu chose the opening press's
   `pointerType` (`2026-10-16-song-tab-context-menu` decision 5, windsor#825
   decision 3), because a keyboard is laid out before any press. On a fine
   pointer nothing changes. The touch row:
   - White keys of equal width, never narrower than 44 px: the keys box's
     `min-width` is the white key count × 44 px, 616 px for 14 whites, so
     where the row leaves less beside the buttons the buttons wrap under
     the keys rather than a key going under 44 px.
   - Black keys over the whites at their real places, centred on the line
     between their two white keys, 60 % of a white key's width and 62 % of
     its height, in place of today's inline black keys at 0.62 of the flex.
   - 110 px high, where today's row is 46 px (proposed; To decide in the
     mockup).
   - Two octaves, as today: 14 white keys.

   In the mockup, with Expand added: at 1024 × 1366 the keys take the whole
   row, 996 px, a white key 71.1 px, with the buttons on the line below; at
   1366 × 1024 the keys take 823.5 px beside the buttons, a white key
   58.8 px. Today's colours and lit colour stay.
5. **A slide plays.** A finger that slides onto another key strikes it and
   then lifts the key it left, keeping its strike velocity, so a poly patch
   overlaps the two for a moment and a mono patch takes the new note as it
   takes any new note. Sliding off the row lifts. The keys box, not the
   key, captures the pointer, and the key under a point comes from the
   row's geometry, a pure `keyAt(x, y)` over the layout read once when the
   first pointer goes down, tested; never `elementFromPoint`. Black keys
   are tested first, since they lie on top. The rule applies to every
   pointer type: on the desktop a mouse drag across the keys slides too.
   The held source becomes `pointer:<pointerId>:<note>`, so the Roll's tap
   records a slide as two notes.
6. **A strike velocity from where the finger lands**, for touch and pen
   only; a mouse keeps `FIXED_VELOCITY` (0.9). With `y` the point's
   distance down from the key's top edge and `h` the key's height:

   velocity = floor + (1 − floor) × y ÷ h, clamped to floor … 1

   The far edge is soft, the near edge full, and a black key reads over its
   own height. Proposed values, in `keyboardConstants.ts`: a floor of 0.6
   and 1.0 at the near edge, linear. The floor is what keeps a drum
   snapping from anywhere on the key. Worked through:

   | Key | Height | 0.6 at | 0.8 at | 1.0 at |
   |---|---|---|---|---|
   | Touch row, white | 110 px | 0 | 55 px | 110 px |
   | Touch row, black (62 %) | 68.2 px | 0 | 34.1 px | 68.2 px |
   | Expanded, landscape, 1 row, white | 821 px | 0 | 410.5 px | 821 px |
   | Expanded, landscape, 1 row, black | 509 px | 0 | 254.5 px | 509 px |
   | Expanded, portrait, 1 row, white | 1163 px | 0 | 581.5 px | 1163 px |
   | Expanded, portrait, 1 row, black | 721.1 px | 0 | 360.5 px | 721.1 px |

   A point on a white key below a black key's foot still reads over the
   white key's whole height. The velocity is the strike's and does not
   change along a slide. The ear decides: the build ships these values and
   tacowars listens; the mockup only draws the zones.
7. **The expanded keyboard view** is the third expanded view of the #855
   family (`docs/design/expanded-views-below-header-mockup.html`, tablet
   frames in #856). An Expand button on the keys row, with the roll's rail
   icon (`rollExpand.ts`'s expand path) and the word, opens the keyboard
   below the live console header on an opaque ground, 16 px under the
   header and 24 px from the sides and bottom, as wide and tall as the
   window allows. The part chips stay live, so picking a part moves the
   keyboard to it (`followPart` already moves bend and wheel). Esc while
   the view is shown, or its Close, closes it. One expanded view at a time
   (#856 decision 2). Its bar: the title in the family's form ("Keys —
   Keyboard"), Oct −, the octave label, Oct +, Octaves, Rows, Hold, Panic
   and Close, every control at `.btn`'s 28 px. The MIDI selector stays on
   the Parts tab. The view's code builds on the expanded-views build, which
   is not yet ticketed: windsor#864 waits on it.
8. **Scale: Octaves and Rows.** Octaves is 1 · 2 · 3 · 4 and Rows is 1 · 2,
   each the Drive switch's segmented control at the bar's height. The keys
   fit the view's width, with no sideways scrolling (`touch-action: none`
   leaves no swipe, and a scroll under a chord is wrong anyway), and the
   view's height. A white key is never narrower than 44 px: an option that
   would go under it is disabled ("4 octaves needs 2 rows at this width").
   A disabled option stays tappable, dimmed and `aria-disabled`, and a tap
   on it leaves the pick as it is and writes the reason in a hint beside
   Octaves and Rows until the next pick, since a touch never shows a
   title; the title stays for the mouse. Rows 2 is offered for 2 and 4
   octaves, an even split, the lower octaves on the lower row; for 1 and 3
   it is disabled ("2 rows takes 2 or 4 octaves"). Default: 2 octaves,
   1 row. The pick is a console preference in `localStorage`, wrapped in
   try/catch, never song data (the pattern of windsor#778 decision 7).
   A pick is normalized before it renders, the default and a restored
   preference alike, whenever the view opens or its room changes: the
   view draws the pick if the room allows it, else the same rows with
   fewer octaves, else one row with fewer octaves. The stored preference
   stays what the user picked.

   The room is the viewport less the view's padding, 2 × 24 px: 1318 px in
   landscape (1366 px) and 976 px in portrait (1024 px). Its height is the
   viewport less the 127 px header, 16 px above the bar, the 28 px bar,
   8 px under it and 24 px at the bottom: 821 px in landscape, 1163 px in
   portrait. Two rows split it with a 12 px gap. A white key is the room's
   width over the white keys in a row:

   | Octaves | Rows | Whites a row | Landscape white key | Landscape row | Portrait white key | Portrait row |
   |---|---|---|---|---|---|---|
   | 1 | 1 | 7 | 188.3 px | 821 px | 139.4 px | 1163 px |
   | 2 | 1 | 14 | 94.1 px | 821 px | 69.7 px | 1163 px |
   | 2 | 2 | 7 | 188.3 px | 404.5 px | 139.4 px | 575.5 px |
   | 3 | 1 | 21 | 62.8 px | 821 px | 46.5 px | 1163 px |
   | 4 | 1 | 28 | 47.1 px | 821 px | 34.9 px: disabled | — |
   | 4 | 2 | 14 | 94.1 px | 404.5 px | 69.7 px | 575.5 px |

   So in landscape every pick is allowed, and in portrait 4 octaves takes
   2 rows. **Oct − / Oct +** shift the whole range, and the label names its
   lowest C as today: `C${octave}`, the note being 12 × octave + the key's
   offset (`Keyboard.press`). The engine's note range is 0 … 127
   (`MIDI_NOTE_MAX`, `audioConstants.ts`; the song's notes are clamped to
   it by `partNoteOn.ts`, `rollNormalise.ts` and `sequencerNormalise.ts`,
   while `AudioPart.noteOn` passes a note through unclamped, so the
   keyboard keeps itself inside). With n octaves shown, the highest key is
   12 × octave + 12n − 1, which stays within 127 while octave ≤
   (128 − 12n) ÷ 12:

   | Octaves | Fits up to | `OCTAVE_MAX` | Highest key at the bound |
   |---|---|---|---|
   | 1 | 9 | 8 | 107 (B8) |
   | 2 | 8 | 8 | 119 (B9) |
   | 3 | 7 | 7 | 119 (B9) |
   | 4 | 6 | 6 | 119 (B9) |

   One octave keeps today's 8 although 9 would fit, so the Parts row's
   bound and the view's agree for 1 and 2 octaves and closing the view
   never moves the octave. `OCTAVE_MIN` stays 0 (C0, note 0). The QWERTY
   keys reach offset 15 (`p`), 111 at C8, inside the range at every bound.
   On closing, the octave clamps to the Parts row's bound, 8.
9. **The desktop keys row changes by one button**: Expand, at the end of
   its button group, on every device. Everything else at 720 px and wider
   with a fine pointer is pixel for pixel today's, except that the keys
   give Expand its room: at 1440 × 900 the button is 91.1 px with an 8 px
   gap, the keys box goes from 996.7 to 897.5 px and a white key from 46.7
   to 41.8 px.
10. **The phone.** Below 720 px (the phone block of `2026-10-04-phone-header`)
    the keys row shows one octave: 7 white keys at 44 px is 308 px, so it
    fits 360 px. At 390 × 844 the keys take the row's 362 px, a white key
    51.7 px, with the buttons under them. The expanded view is the way to
    play more. Its room at 390 × 844 is 390 − 2 × 24 = 342 px, so it allows
    1 octave at 1 row and 2 octaves at 2 rows, each 342 ÷ 7 = 48.9 px, and
    disables everything else (the next widest, 14 whites a row, is
    24.4 px); the default opens at 1 octave, 1 row. The key count becomes a
    layout value (24 wide, 12 on the phone, `KEY_COUNT` and a phone count in
    `keyboardConstants.ts`); a QWERTY offset past the shown keys plays with
    no key lit, as a MIDI note outside the row does today (`midiSink`'s
    `offset < KEY_COUNT`).
11. **Later**, not in this build:
    - pressure and aftertouch from `PointerEvent.pressure`;
    - a pitch ribbon, or a finger's slide becoming a bend;
    - chord memory;
    - Hold as a per-key toggle;
    - scale-locked and isomorphic layouts;
    - a phone landscape view;
    - the desktop frame of the expanded view;
    - one octave naming: the label calls note 48 C4, while `noteName`
      (`consoleFormat.ts`) and the roll call 60 C4.
12. **The build plan**, filed and waiting on this record's approval:
    - windsor#863, Keyboard 1/2: the touch-sized keys row, the slide, the
      strike velocity and the phone's one octave (`worker`, `reviewed`).
      After windsor#859 and windsor#857.
    - windsor#864, Keyboard 2/2: the expanded keyboard view with Octaves
      and Rows (`worker`, `reviewed`), after Keyboard 1/2 and the
      expanded-views build.

    A value the approved mockup changes from this record's is theirs to
    follow; the main session carries it into their bodies.

## Boundary cases

Each checked against `keyboard.ts` and the engine as they stand, with
windsor#859's per-pointer sources assumed.

- **A finger sliding off the row's edge.** `keyAt` finds no key, so the
  finger's note lifts (`lift`: `noteOff` unless Hold keeps it) and its key
  goes dark; it plays nothing until it is back on a key, which strikes
  afresh at the new point's velocity. Today a key keeps its pointer
  captured, so the note sounds until the finger lifts wherever it is.
- **Two fingers meeting on one key.** The key is already held, so the
  arriving finger strikes nothing there (windsor#859 decision 2) and lifts
  the key it left: the key sounds once, and its note stops when the finger
  that struck it lifts or leaves. The arriving finger strikes again only
  when it moves onto another key.
- **A chord under Hold, then Panic.** Each finger's lift drops its entry
  without a `noteOff`, and its key goes dark, so the chord rings on the
  engine with no key lit. Panic calls `panic()` on every part this
  keyboard has sounded since the last Panic (`sounded`), clears every
  entry and every `.key.down`, and tells the tap. Turning Hold off panics
  too (`partsTab.ts`).
- **Switching parts mid-chord.** Each entry keeps the `AudioPart` that
  struck it, so the held notes stay on and each lifts on the part that
  struck it, never on the new one. The next finger plays the new part.
  The controller's bend and wheel move to the new part (`followPart`), and
  the old part's return to rest under its held chord.
- **A chord on a mono patch.** Each new finger's `noteOn` cuts every
  sounding voice with the 4 ms `Voice.steal` and drops them from the note
  map (`cutSounding`), so the newest finger sounds. Lifting it releases
  that note and leaves silence: an older finger's `noteOff` finds nothing
  to release, and nothing returns to an older finger's note. The keyboard
  sends no `slide` flag, so the engine's legato slide (#602, `slideTo`) is
  not used: a mono slide retriggers, with `glide` if the patch has it.
- **A thirteenth finger.** The engine steals as decision 2 says: the
  quietest released voice still sounding, else the oldest held note,
  faded over 30 ms. That finger's key stays lit until it lifts; its later
  `noteOff` reaches a voice already fading or silent, which changes
  nothing you hear.
  On a patch with `spread` the seventh finger steals.

## Consequences

- On a tablet the Parts tab's keys row grows from 74 px to 138 px in
  landscape and 180 px in portrait, where the buttons wrap under the keys.
- The expanded view's keys are tall: a white key is 821 px in landscape
  and 1163 px in portrait at 1 row. The height is the velocity's range, so
  a tall key gives a fine touch; 2 rows halve it.
- The Roll's tap hears a slide as one note per key, and a touch strike's
  velocity is recorded as played (`2026-10-09-roll-recording` decision 6).
- A tablet with a trackpad matches `(pointer: coarse)` and gets the touch
  row; a mouse there plays at 0.9 as anywhere.
