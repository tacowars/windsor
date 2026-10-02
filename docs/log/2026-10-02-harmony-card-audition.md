# The harmony card writes quality and accidental, and auditions each degree

- **Date:** 2026-10-02
- **Status:** accepted (windsor#332, whose decisions tacowars agreed on
  2026-10-02; the audition patch waits for tacowars's listen)
- **Builds on:** `2026-10-02-harmony-events-quality-and-accidental`
  (windsor#330: the `quality` and `accidental` fields, `eventStack`,
  `eventChord`)

## Context

windsor#330 let a harmony event name a chord quality and an accidental, but
the Song tab's harmony card could still write only degree, size and
duration. A chromatic chord could be loaded from JSON and not written in the
console, and no chord could be heard without running the song.

## Decision

1. **The approved mockup is the spec.** The card is built to
   `docs/research/2026-10-02-harmony-card/harmony.html`, which tacowars
   approved "as is" on 2026-10-02. Top to bottom: the Degree label, a ▶ over
   each degree chip on the chips' grid, the chips, then Accidental (♭ ♮ ♯),
   Size and Quality (`Scale's own` or one of the twelve named qualities),
   then the info bubble, the Duration dial or the last event's hint, and
   Delete at the row's right end.
2. **The edits are pure.** `setQuality` and `setAccidental`
   (`harmonyLaneModel.ts`) remove the key for the default (the scale's own
   chord, natural), so an export carries no default field. A quality also
   sets the size it spells, and Size clears a quality (windsor#330).
3. **Which chord a ▶ plays** (`harmonyAuditionModel.ts`'s `auditionChord`):
   - the selected degree's ▶ plays the selected block as written: its
     degree, size, quality and accidental;
   - every other ▶ plays the scale's own chord at that degree, at the
     selected block's size, with no quality and no accidental.

   The stack is the engine's `eventStack`, the rule every performer reads.
   **The voicing** is close, root position, from the key root in octave 4
   (C4 = MIDI 60), plus the stack's root an octave below, so the quality is
   easy to hear whatever the song's parts do. A note outside MIDI is dropped,
   never clamped, as `voiceChord` does.
4. **A ▶ sounds only while held**, and never selects, commits or touches
   undo. One chord sounds at a time across the console: a second press
   releases the first, and a release is also heard on the window, so a pane
   repainted mid-hold cannot strand a note. It plays with the transport
   stopped or running. Before audio is enabled a press does nothing.
5. **The audition voice is on the engine's `audition` aux strip.** The host's
   `auditionPart()` makes one part with `AudioSystem.createAuxPart('audition',
   patch)` on the first press, keeps it for the live system, and drops it when
   a rebuild disposes that system. An aux part is dry into the aux fader, so it
   skips the song master, the song's mixer, mute, solo and the music fader: an
   audition is the user listening to the harmony, not part of the mix, and it
   must be heard the same however the song is mixed. The strip's own small
   send to Send A (`MIX.audition`) is the engine's and still reaches the
   returns.
6. **The patch** is one fixed built-in, `score-muted-chamber`
   (`harmonyAuditionTables.ts`), at velocity 0.8: a soft muted-strings bed
   whose attack is about a quarter second and whose release is under a
   second, the quickest of the candidates, so a chord speaks at once and stops
   cleanly. tacowars judges it by ear on the preview.
7. **The card is a sequencer device's height** (tacowars on the preview,
   2026-10-02: "scale it up to where its the same height as the
   sequencers"). The mockup's arrangement stands at a larger scale: 244 px
   high, `--seq-h` from `SEQUENCER_DEVICE_PX`, with the chips about twice
   as tall and their pitch names 12 px in `--ink-dim`. Every size is
   `harmonyCardTables.ts`'s `HARMONY_CARD_PX`, set on the card as custom
   properties. The pressed chip is the event's folded degree, as a ▶ reads
   it.
