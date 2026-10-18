# The keyboard fold: a part folded to the song's scale or chord

- **Date:** 2026-10-18
- **Status:** proposed, accepted when tacowars approves the mockup.
- **Mockup:** `docs/design/keyboard-fold-mockup.html`, with its frames
  rendered as `docs/design/keyboard-fold-today-*.jpg` (main at 23f0087,
  captured from `npm run dev` in the project's headless Chrome) and
  `docs/design/keyboard-fold-proposed-*.jpg`.
- **Links:** this record's issue, windsor#911 · the keyboard on a tablet
  `2026-10-17-the-keyboard-on-a-tablet` · its geometry
  `2026-10-17-keyboard-geometry-follows-the-layout` · recording
  `2026-10-09-roll-recording` · the Roll zoom spec
  `2026-10-18-roll-zoom-bars-and-duplicate` (windsor#910 builds it) ·
  Bloom's Song chord (windsor#729 decision 2) · format rules
  `2026-09-28-format-versions-refuse-never-destroy`
- **Amends:** `2026-10-17-keyboard-geometry-follows-the-layout` decision 2,
  for a fold's rename only (decision 5 below), without editing it.

## Context

The audition keyboard (`keyboard.ts`) is chromatic: 24 keys on the Parts
tab, 1 to 4 octaves in one or two rows in the expanded view. On a tablet,
where it is the only instrument, most of what a finger can hit is a wrong
note for the song. tacowars asked on 2026-10-18 for a groovebox's keyboard
fold: a part folded to the song's scale, or to the chord the song is on,
plays only those notes, one equal key per note. The decisions below were
agreed with tacowars the same day; this record works them through the
keyboard's rules, and the mockup draws them on each device.

## The demo song

The screenshots and every example use one song: A minor, 120 BPM, four
bars, harmony A min, F maj, C maj, G 7, one bar each (degrees 0, 5 and 2 as
triads and degree 6 as a seventh), and three Roll parts, Keys on Submerged
Keys, Bass on Digital Bass and Kick on 909 Kick. The mockup's second song
is A minor pentatonic with no chords.

Note names follow the keyboard's octave label, where note 48 is C4 (the
label is `C${octave}` over note 12 × octave). The Roll and `noteName` call
note 60 C4, an octave higher; one naming for both stays on the tablet
record's Later list. So A3 below is note 45.

## Decisions

1. **One setting per part, saved in the song.** A new `MusicPart` field,
   `fold: 'off' | 'scale' | 'chord'`, default `'off'`, so a bass part stays
   folded and a drum part stays unfolded as the selection moves. The field
   is additive and its default reproduces today's behavior, so it bumps
   nothing (`2026-09-28-format-versions-refuse-never-destroy`): the
   normalizer reads anything else as `'off'`. An edit goes through
   `ctx.change`, is one undo step, and round-trips through export and
   import.

2. **One control in three places.** A segmented **Fold: Off · Scale ·
   Chord**, the expanded view's Octaves and Rows control (`.kb-pick`,
   `.kb-seg`, 28 px) with three options, measured in the app at 168 px
   (label 26.7, gap 6, buttons 44, 44, 45.3):
   - on the Parts tab's keys row, after Oct +;
   - in the expanded keyboard's bar, after Rows;
   - on the Roll device, as the last item of the second column, under Rec,
     labelled **Keyboard fold** (the Roll already has a Fold, All | Fold,
     that hides its empty rows), at the column's 112 × 20 px. The Roll
     device is drawn as the approved Roll zoom spec lays it out (option B:
     Show Loop | Region with its hint, the zoom bars, Dup), not as main does
     today. Its second column then holds Show (58 px with the hint's two
     lines), Audition and Rec (33 px each) and the metronome (20 px): the
     fold's 33 px does not fit under the metronome in the column's 177 px,
     so the metronome moves beside Rec's switch, which keeps 89 px for Off
     and Rec. The column is then
     58 + 33 + 33 + 33 + 3 × 3 = 166 px, 177 px with Rec's hint shown.

   All three show and edit one part's field: the part the keyboard plays,
   which is the slot Rec records into (`RecorderHost.selected`: the
   selected part, or the Expanded roll's while it is on screen, windsor#873
   decision 3). On screen they always agree, since the pane shows the
   selected part's devices and the Expanded roll covers them; a Roll device
   shown for any other part draws its fold disabled, titled "Fold follows
   the part the keyboard plays".

3. **The set.**
   - **Scale:** the song's key and scale, from `scalePitchClasses`
     (`rollHarmony.ts`), as the Roll colors notes. A custom scale works the
     same way. Its root is the key's root.
   - **Chord:** the chord's tones at the tick, `tonesOf` over the engine's
     `chordAt`, which carries the quality, accidental and size. Its root is
     the chord's root (`tonesRoot`). With no harmony events the fold falls
     back to the scale, as Bloom's Song chord does (windsor#729 decision 2).
   - **The tick:** the audible playhead while the transport runs
     (`audibleTick`, as `chordRegionChord.ts` reads it), otherwise where the
     playhead stands (the logic of `rollGuide.ts`).

4. **The folded keys.** One equal rectangle per tone, with no black keys,
   each named with its note (`A`, `C`, `E`, in the app's spelling,
   `CHORD_NOTE_NAMES`). The first key is the set's root in the octave the
   label names: note 12 × octave + the root's pitch class. A row holds
   (octaves shown × tones in the set) + 1 keys, ending on the root one
   octave or more up, and the label names the first key (`A3`, not `C3`).
   Oct − and Oct + move it by an octave within today's bounds
   (`OCTAVE_MIN` 0, and `octaveMaxFor`: 8 for 1 and 2 octaves, 7 for 3,
   6 for 4). Worked through:

   | Set at octave 3 | Tones | 2 octaves | Keys |
   |---|---|---|---|
   | A minor | 7 | 15 keys | A3 B3 C4 D4 E4 F4 G4 A4 B4 C5 D5 E5 F5 G5 A5 (45 to 69) |
   | A minor pentatonic | 5 | 11 keys | A3 C4 D4 E4 G4 A4 C5 D5 E5 G5 A5 |
   | A min (triad) | 3 | 7 keys | A3 C4 E4 A4 C5 E5 A5 |
   | F maj (triad) | 3 | 7 keys | F3 A3 C4 F4 A4 C5 F5 (41 to 65) |
   | G 7 (seventh) | 4 | 9 keys | G3 B3 D4 F4 G4 B4 D5 F5 G5 (43 to 67) |

   At the top bound the closing root can pass the engine's range (0 … 127,
   `MIDI_NOTE_MAX`): with 2, 3 or 4 octaves at their bound the last key is
   120 + the root's pitch class, past 127 for a root of G♯, A, A♯ or B. A
   key past 127 is drawn hatched and plays nothing; at octave 8, A minor's
   closing A would be 129, and every other key is in range. The bounds do
   not move.

   **The Parts tab keys row.** Its octave count keeps its rule, with the
   keys standing in for the white keys: on a touch layout two octaves when
   their keys fit at 44 px in the row's room (`roomFor`: 1338 px in
   landscape, 996 px in portrait; 15 keys need 660 px), else one; with a
   fine pointer always two. The touch row's keys box keeps a minimum width
   of the larger of the unfolded row's (14 × 44 = 616 px) and the folded
   row's (keys × 44), capped at the row, so the buttons never come back
   beside the keys when a chord or a fold has fewer keys. Measured in the
   app with Fold in the row, the keys box is 721.6 px on the desktop (897.5
   today), 647.6 px in landscape (823.5 today) and 996 px in portrait. A
   folded key is the box over its keys, less the desktop's 2 px gaps:

   | Set | Keys | Desktop 1440 × 900 | Landscape 1366 × 1024 | Portrait 1024 × 1366 |
   |---|---|---|---|---|
   | Off | 24 (14 whites) | 33.1 px white (41.8 today) | 46.3 px white (58.8 today) | 71.1 px white |
   | 7 tones (A minor) | 15 | 46.2 px | 50.9 px, Enable MIDI on a second line | 66.4 px |
   | 5 tones (pentatonic) | 11 | 63.8 px | 58.9 px | 90.5 px |
   | Seventh | 9 | 78.4 px | 72.0 px | 110.7 px |
   | Triad | 7 | 101.4 px | 92.5 px | 142.3 px |

   In landscape, 15 keys in 647.6 px would be 43.2 px, under 44, so the
   660 px minimum sends Enable MIDI to a second line: the row grows from 138
   to 180 px and the keys take 763.3 px. Only a six- or seven-tone Scale
   fold does this (13 keys need 572 px, which fits); a pentatonic, a chord
   and Off keep today's line. The desktop has no minimum, as today.

   **The expanded view.** Octaves and Rows keep their rules
   (`keyboardViewModel.ts`), with the slots of a row standing in for its
   white keys: a key is the room's width over (octaves a row × tones) + 1.
   A pick is offered when its key is at least 44 px; one octave in one row
   is always offered; Rows 2 still takes 2 or 4 octaves. The room is
   1392 px on the desktop, 1318 px in landscape and 976 px in portrait (the
   viewport less 2 × 24 px):

   | Pick | 7 tones | Desktop | Landscape | Portrait | 5 tones | Portrait | Triad | Portrait | Seventh | Portrait |
   |---|---|---|---|---|---|---|---|---|---|---|
   | 1 × 1 | 8 | 174.0 | 164.8 | 122.0 | 6 | 162.7 | 4 | 244.0 | 5 | 195.2 |
   | 2 × 1 | 15 | 92.8 | 87.9 | 65.1 | 11 | 88.7 | 7 | 139.4 | 9 | 108.4 |
   | 2 × 2 | 8 | 174.0 | 164.8 | 122.0 | 6 | 162.7 | 4 | 244.0 | 5 | 195.2 |
   | 3 × 1 | 22 | 63.3 | 59.9 | 44.4 | 16 | 61.0 | 10 | 97.6 | 13 | 75.1 |
   | 4 × 1 | 29 | 48.0 | 45.4 | 33.7: dimmed | 21 | 46.5 | 13 | 75.1 | 17 | 57.4 |
   | 4 × 2 | 15 | 92.8 | 87.9 | 65.1 | 11 | 88.7 | 7 | 139.4 | 9 | 108.4 |

   (Widths in px; every five-tone, triad and seventh width on the desktop
   and in landscape is wider than its portrait one.) So folded, every pick
   is offered on the desktop and in landscape. In portrait a seven-tone
   scale dims 4 octaves in 1 row, as Off does (34.9 px), and so does a
   six-tone scale (25 slots, 39.0 px); a pentatonic (46.5 px) and every
   chord allow it. A pentatonic or a chord fold therefore gets wider keys
   and more picks. The view normalizes its pick, as it does when it opens
   or its room changes, whenever the set's tone count changes (a fold
   switch or a chord change); at these rooms a chord change never changes
   the pick, since no triad or seventh pick is under 44 px.

   With Fold in it, the expanded bar stays one line on the desktop and in
   landscape (Panic ends at x = 1006.7 px, short of Close), so the rows keep
   their height: 731.1 px and 855.1 px in one row, 359.5 px and 421.5 px in
   two. In portrait the bar wraps to two lines (64 px), and a row is
   1127.1 px in one row and 557.5 px in two (1163.1 and 575.5 today).

   Two rows split the octaves evenly, the lower octaves on the lower row,
   and every row ends on its root, so a row is complete and the rows' keys
   line up (the lower row's last key and the upper row's first are the same
   note; To decide 4).

5. **Chord fold follows the song.** When the chord changes, the keys
   rename at that tick. A held note keeps sounding: the note is its
   holder's identity, not the key (`2026-10-17-keyboard-geometry-follows-the-layout`).
   Its key stays lit where a shown key still carries that note, and goes
   dark where none does. A rename changes the notes on the keys, not the
   pointer's key: a move inside the key it is on changes nothing, and a move
   onto another key strikes that key's note now and lifts the held one.
   When the rename also changes the key count (a triad to a seventh, 7 to 9
   keys), the boxes are read again as the geometry record says, except that
   a held pointer never lifts at the re-read for want of its note: that
   record's decision 2 lifts a pointer "whose key no longer exists", and a
   fold's rename is not such a case. The same holds for a Fold switch made
   while notes are held.

6. **Computer keys.** While the part is folded, the home row
   `a s d f g h j k l ; '` plays the first eleven keys in order, and the
   other note letters (`w e t y u o p`) play nothing. `z` and `x` still
   shift the octave. A minor at A3: `a` A3, `s` B3, `d` C4, `f` D4, `g` E4,
   `h` F4, `j` G4, `k` A4, `l` B4, `;` C5, `'` D5. With fewer than eleven
   keys shown, the letters past the row play the set's next tones with no
   key lit, as a QWERTY offset past the shown keys does today
   (`2026-10-17-the-keyboard-on-a-tablet` decision 10): A min on two
   octaves is 7 keys, A3 to A5, so `k` plays C6, `l` E6, `;` A6 and `'` C7.

7. **MIDI.** While the part is folded, a MIDI note outside the set is
   ignored: it is not sounded, not recorded and not lit, and its release
   finds nothing to lift. MIDI pitches are never remapped. With Chord, the
   note is judged at the tick it was heard (its `timeStamp`, as the
   recorder stamps it, `RecorderHost.stamp`). It also passes when it
   belongs to a chord that starts within a **grace window** after that
   tick, so a note played just before a chord change is kept. **Proposed
   window: 1/16, 6 ticks at 24 PPQ.** With the transport stopped, the note
   is judged at the tick where the playhead stands, with no window, since
   no change is coming.

   At 120 BPM a tick is 500 ms ÷ 24 = 20.8 ms, so the window is 125 ms.
   A min plays bar 1 and F maj starts at bar 2, tick 96:
   - An F heard 15 ms before the change is at tick 96 − 15 ÷ 20.8 = 95.28.
     A min (A C E) does not hold F, but F maj starts at 96, within
     95.28 + 6 = 101.28, and holds it: the F is **kept**, sounded, lit and
     recorded, where the recorder writes any note.
   - A B heard at the same moment is in neither A min nor F maj: it is
     **dropped**.
   - An F heard 150 ms early (tick 88.8) is dropped: the window ends at
     94.8, before the change.

   The window reads the timeline as the transport plays it: past the
   song's end, or a transport loop's end, the next chord is the one the
   transport plays next (`chordAt` is cyclic over `songTicks`).

8. **The recorder is unchanged.** It records what the keyboard plays
   (`2026-10-09-roll-recording` decision 2), so the fold is its filter. The
   Roll's own Audition and its chromatic key column are not folded.

9. **Hold, Panic, bend, the wheel and velocity are unchanged.** A touch
   strike's velocity follows the same rule on a folded key
   (`2026-10-17-the-keyboard-on-a-tablet` decision 6), over the key's own
   height.

## Boundary cases

Each checked against `keyboard.ts`, `keyboardViewModel.ts` and the
recorder as they stand.

- **A MIDI note held through a chord change.** An E passes under A min and
  is held while F maj starts. Its release lifts it: the filter judges note
  ons only, and a release lifts whatever its press sounded, whatever the
  chord is now. Its key goes dark at the change (no F maj key carries E)
  and the note sounds on until the release.
- **A dropped MIDI note that the next chord holds.** A B dropped under
  A min, still held when G 7 starts, stays silent: nothing re-judges a held
  key. Its release finds nothing to lift.
- **A held finger on a renamed key.** A finger holds the fourth key, A4,
  under A min. At F maj the fourth key is F4 and the fifth A4: the A4 sounds
  on, the fifth key lights, the fourth stays dark under the finger. The
  finger's wobble inside the fourth key changes nothing; a slide onto the
  third key strikes C4 and lifts A4.
- **Triad to seventh under a held finger.** C maj (7 keys) to G 7 (9 keys)
  on the Parts row: the boxes narrow and are read again. A held finger
  keeps its note, as decision 5 says, and its next move is judged by the
  new boxes.
- **Fold switched while playing.** A Fold tap while fingers or MIDI notes
  are held keeps every held note sounding; the keys change at once and the
  lit keys follow decision 5. The tap is one undo step; undo switches the
  keys back the same way.
- **A song with no chords.** Chord folds to the scale; the label names the
  key's root, and a MIDI note is judged against the scale with no window.
- **Part switch.** The keyboard plays the new part, folded or not by its
  own field; held notes stay on the part that struck them (the tablet
  record's boundary case). All three Fold controls show the new part's.
- **The range's top.** At octave 8, two octaves of B minor run 107 to 131:
  the keys past 127 (129 and 131 here) are hatched and play nothing; a home
  row letter on them plays nothing.
- **Recording.** A kept early note is recorded at the tick it was heard,
  95.28 in the example, and written where the recorder writes any onset;
  Quantize moves it. A dropped note leaves no trace in the take.

## Consequences

- `MusicPart` gains an optional `fold`; songs without it load as Off and
  play as today. Nothing else in the song changes.
- The keyboard gets a folded layout beside its chromatic one. `keyAt`,
  `strikeVelocity` and the view model stay pure functions of the layout,
  so the folded rules are tested in Node: the key lists and counts above,
  the picks each room allows, the grace window and the home row.
- The MIDI sink gains a judge (the set at the heard tick, plus the window)
  that keeps which note ons it passed.
- On the desktop the Parts row's keys give Fold 176 px (a white key 41.8 to
  33.1 px); in landscape 176 px (58.8 to 46.3 px); in portrait the
  buttons' line has the room.
- The build tickets, written once the mockup is approved: the field and a
  pure fold model (the set at a tick, the folded keys, the window) as a
  seam; then the keyboard's folded layout, computer keys and MIDI judge;
  then the three controls, the Roll device's after windsor#910.

## To decide

1. **How a root key is marked.** Recommended: its name carries the octave
   (A3, A4, A5) in full ink, with a 2 px rule along its top; the others
   show the letter only. The mockup can turn it off.
2. **The colors.** Recommended: Scale keeps today's key color, and the
   tones of the chord at the playhead carry a 3 px amber strip at the foot,
   the Roll's chord tier (`--carrier`), so the chord shows inside the scale
   and moves with the song. Chord needs no strip, since every key is a
   chord tone. A held key keeps today's amber fill. The Roll's scale tier
   (teal) is not used: every folded key is in the scale.
3. **Where Fold sits in each bar.** Recommended as drawn: after Oct + on
   the Parts row, after Rows in the expanded bar (in portrait the bar wraps
   to two lines and the keys lose 36 px of height), and last in the Roll
   device's second column with the metronome beside Rec.
4. **Whether the closing root key stays**, and in two rows whether every
   row ends on its root (recommended; the shared note lights on both keys,
   and a second finger on a held note's other key strikes nothing, as on a
   held key), only the top row does (the lower rows keep an empty slot so
   the columns line up), or no row does (2 octaves of A minor become 14
   keys). The mockup switches between the three.
5. **The Roll device's label.** Recommended: Keyboard fold, beside the
   Roll's own Fold. The other way renames the Roll's Fold.
6. **The landscape row with a seven-tone Scale.** Recommended: Enable MIDI
   wraps while such a fold is on (the row grows 42 px). The other way drops
   the Fold label on the Parts row (136 px), leaving the keys 680.3 px,
   45.4 px a key, on one line.
7. **The grace window.** Proposed 1/16, 6 ticks, 125 ms at 120 BPM. The
   hand decides, as the ear does for a sound.
8. **The chord fold's register.** The first key is the chord's root in the
   label's octave, so under A min the keys start at A3 (45) and under C maj
   at C3 (36): the row moves by up to eleven semitones as the chord
   changes. Proposed as decision 4 says; the other way starts each chord at
   its root nearest the key's root.
