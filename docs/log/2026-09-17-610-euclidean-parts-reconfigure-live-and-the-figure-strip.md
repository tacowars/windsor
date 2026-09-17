# Euclidean parts reconfigure live; the console shows the figure

- Date: 2026-09-17
- Area: audio
- Links: issue #610 · #603 / PR #608 (the grid's `reconfigure`, the shape
  this follows) · `2026-08-31-generative-sequencing-transport-and-pitch` §3
  (the bar-line rule) · `2026-09-17-602-grid-sequencer-degrees-accent-slide`

## Decision

From Pat's brief of 2026-09-17: a Euclidean part must be playable live — no
parameter turn restarts it — and the console must show its figure as the
modulator moves it and as the knobs turn, Drambo's Euclidean module being the
reference. Points 1 and 4 are Pat's; 2, 3 and 5 are the implementer's reading
and stand unless Pat objects at review.

1. **Every Euclidean field but the divisor reconfigures the live generator.**
   `EuclideanSequencer.reconfigure(config)` keeps the stream and the current
   `k` (clamped into the new bounds) and refuses a divisor change (the
   subscription) or a seed change (the stream). The player's `generatorSig`
   for a Euclidean part is its kind and divisor, as the grid's is, and the
   plan validates each kept-live config with the constructor's own assert
   inside the transaction, so a bad edit is refused before the tempo, the
   patches or the arrangement change. Before this, `generatorSig` compared
   the whole driver: Steps, Rotate, a `k` bound or a density change reset
   `k` to `pulses.start`, restarted the walk and re-cut the figure from
   scratch.
2. **A hand edit re-cuts at once; the modulator still moves `k` only on a
   bar line.** The 2026-08-31 rule is about the modulator — a density
   change never re-cuts mid-flight, and that stands. A knob turned by hand
   is a performance gesture and shows on the strip the moment it is turned.
   Position is unchanged either way: the step is `floor(tick / divisor)
   mod n` from the transport, so a re-cut never moves the playhead.
   Alternative: defer hand edits to the bar line too. Rejected: it hides the
   edit for up to a bar and is not what Drambo does.
3. **Capture and release are live too.** A `pattern` arriving through
   `reconfigure` swaps the generator to the fixed figure — the figure
   already sounding, so nothing audibly changes — and `null` returns it to
   generative from the current `k`.
4. **The card shows the figure the player holds.** A strip of `n` cells,
   the onsets lit, the playhead ringed from `Scheduler.audibleTick` while
   the transport runs, a `k / n` readout; the figure is re-read each frame
   through the existing `capturePattern` seam and repainted only when it
   changes, so a modulator moving `k` on a bar line is seen the bar it
   happens. With no player the strip previews `E(start, n)` rotated, or the
   document's captured pattern. The strip wraps rather than scrolls: 64
   small cells in rows, grouped by the beat where the divisor divides it.
5. **A Steps turn carries the fields `n` bounds along, and a cell click
   freezes the figure.** One partial sends `steps` with the pulse bounds
   clamped to the new `n`, the rotation held within `±n` and a captured
   figure resized by the normaliser's own rule, so a turn never lands in the
   engine's refusal; the `k` knobs drag each other so `min ≤ start ≤ max`
   holds; Rotate is clamped to `±n` so the live figure and the document
   agree. Clicking a cell writes the current figure with that step flipped
   as the part's `pattern`, the Capture button reads Release, and Release
   returns to generative. Alternative: display-only cells, as Drambo's.
   Rejected: one click is the cheapest way to nudge a figure the modulator
   found, and it reuses the capture path with no new schema.

## Why

The grid (#603) had already shown that a rebuild on every knob is the wrong
default for a sequencer someone is playing: the `reconfigure` path exists,
the player's plan already validates a kept-live config, and extending both
to the Euclidean kind is a few lines beside the grid's. The figure strip
makes the modulator's work visible for the first time — until now the only
view of a Euclidean part was a `pattern: x..x..x.` status line that changed
only on capture.

## Punted / alternatives

- No new engine readout: the current step comes from the audible tick as
  the grid card computes it, the figure from `capturePattern`, `k` from the
  figure's onset count.
- The arpeggiator and the step sequencer still rebuild on any driver change.
  Their configs are mostly stream-shaping (pool, refresh, register), where a
  restart is arguably the point; a live path for them is a separate ticket
  if Pat wants it.
