# The keyboard's geometry follows the layout under a held finger

- **Date:** 2026-10-17
- **Status:** accepted; amends `2026-10-17-the-keyboard-on-a-tablet`
  decision 5 without editing it (#851 decision 8's convention).
- **Links:** the keyboard record's issue, windsor#861 · its PR,
  windsor#869, and the review finding there that this answers · this
  record's issue, windsor#879 · the build, windsor#863 (Keyboard 1/2)
- **Builds on:** `2026-10-17-the-keyboard-on-a-tablet` decision 5 (a slide
  plays, and `keyAt` over the keys' boxes), with decision 8's Octaves and
  Rows and decision 10's `ResizeObserver`

## Context

Decision 5 of the keyboard record has the keys box capture every pointer
and find the key under a point with a pure `keyAt(x, y)` over "the layout
read once when the first pointer goes down" and kept until the last
pointer lifts. But the layout can change while a finger is down. A second
finger can tap Octaves or Rows in the expanded view, the device can
rotate, a resize can change the keys box's width and so its octave count
(decision 10), and the view can open or close. A held finger's next move
would then be judged against boxes that no longer match what is drawn,
and could strike a key the finger is not on. The review of windsor#869
found the gap after its round limit, and tacowars chose to merge and
amend.

## Decision

1. **The keys' boxes follow the layout.** The layout `keyAt` reads is read
   again after any re-render or resize of the keys: an Octaves or Rows
   pick, a rotation, a `ResizeObserver` change of the keys box, or the
   expanded view opening or closing. The read when the first pointer goes
   down is the first of possibly several in one gesture, no longer the
   only one.
2. **A held pointer keeps its note across a re-read.** Its entry keeps the
   note, the part and the velocity it struck with, and the note sounds on
   until the pointer's next move. That move is judged against the new
   boxes under decision 5's slide rule: a point on another key strikes it
   and then lifts the old note, a point off the keys lifts it. A held
   pointer whose key no longer exists after the re-read (fewer octaves
   shown, or the view closed) lifts its note at the re-read, the usual
   lift: `noteOff` unless Hold keeps it.
3. **Octaves and Rows stay live while fingers are held.** A chord held
   under Hold while the layout changes is the use case, so the controls
   are not frozen while a pointer is down.

The mockup, `docs/design/tablet-keyboard-mockup.html`, is unchanged: its
demo has no model of a held finger, so nothing in it draws this.

## Boundary cases

Each checked against `keyboard.ts` as merged by windsor#867 (windsor#859),
where a pointer's entry holds its part, note and key, and a lift under
Hold drops the entry without a `noteOff`.

- **Octaves 2 to 4 under a held chord, with Hold on.** A finger holds each
  of three keys in the expanded view at 2 octaves, 1 row, and a fourth
  finger taps Octaves 4. The view re-renders (4 × 1 in landscape, 4 × 2 in
  portrait, decision 8) and the boxes are read again. Every held key's
  note is still shown, so nothing lifts: each note keeps sounding and its
  key in the new layout is lit. The lowest C does not move, so each note
  keeps its offset, but its key now sits at a new place, and in portrait
  on a new row. A held finger that has not moved is no longer over its
  key's new box; its next move is judged by the new boxes, so it strikes
  the key now under it at its own velocity and lifts its old note (which
  Hold keeps ringing) rather than playing by the old boxes.
- **A rotation that drops the pick.** In landscape at 4 octaves, 1 row, a
  white key is 47.1 px. Turned to portrait, 4 octaves in 1 row would be
  34.9 px, so the view draws the same rows with fewer octaves, 3 × 1 at
  46.5 px (decision 8's normalizing), and the stored pick stays 4 × 1. The
  boxes are read again. A finger held on a key in the top octave (offsets
  36 to 47) has no key in the new range, so its note lifts at the re-read:
  `noteOff` without Hold, kept ringing under Hold, and in both cases its
  entry is gone. The pointer itself stays captured, so its next move onto
  a visible key strikes afresh, as a finger sliding back onto the row
  does; it plays nothing only while it rests where no key is. Fingers on
  the lower three octaves keep their notes until they move.
- **Close with a chord held under Hold.** Close is tapped while three
  fingers hold keys in the expanded view. The view's keys are gone, so
  every held pointer's key no longer exists and each lifts at the re-read:
  under Hold the notes stay on the engine, no key is lit, and Panic
  still stops them (`sounded`). The pointers were captured by the view's
  keys box, which is gone, so they play nothing more. The Parts tab's
  keys row is not taken over by those fingers: its boxes are read on its
  next pointer down, as decision 5 has always said for the first press.
  Without Hold the three notes stop at the close.

## Consequences

- windsor#863 builds the re-read with the slide: the keys box's
  `ResizeObserver` and every re-render call one refresh that reads the
  boxes again and lifts the held pointers whose keys are gone. windsor#864
  calls it on an Octaves or Rows pick and on opening and closing the view.
- `keyAt` stays a pure function of the layout and the point, so the rule
  is tested as: the same point gives a different key before and after a
  layout change, and a held note past the new range lifts.
- A finger that rests still through a pick may find a different key under
  it on its next move; that is the layout it now sees, not an error.
