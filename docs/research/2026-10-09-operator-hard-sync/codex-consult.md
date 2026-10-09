# Codex consult: the synced saw's correction (windsor#646)

A second opinion the main session asked of Codex on 2026-10-09, after the
first round's measurement raised `needs-human` (the polyBLEP removed
−0.1 dB on a synced saw). This is a record of the consult, not a copy of
it.

| | |
|---|---|
| Model | `gpt-6-astra`, effort `high` |
| Wall time | 406 s |
| Mode | a read-only review of the branch's source, with arithmetic checks; nothing rendered or auditioned |

## The question

In substance: should the synced Saw, Square and Pulse take a direct-shape
correction, the ideal waveform with a two-sample polyBLEP on every edge
(the reset's included) in place of the table read, as option 1 of the
PR's `needs-human` comment proposed? Is a two-sample kernel enough?

## The answer

Adopt a restricted version, not a blanket replacement. Seven findings:

1. **Phase modulation and feedback.** Under audio-rate PM the read phase
   can cross an edge, or several, with no accumulator wrap, and naive
   feedback taps would change the oscillator itself. Keep the table path
   for modulated or fed operators until a general path is validated.
2. **The reset step's timing.** `applySyncResets` compares the reset and
   free-running phases at the next sample, not the two limits at the reset
   instant. When the free-running phase wraps inside the interval, the
   step is wrong (from phase 0.95 at increment 0.1, a reset a quarter of a
   sample later: the real jump is from 0.975 to 0; the code compared 0.075
   and 0.05).
3. **Width squeeze** adds edges at the hold boundary that the direct
   shape's event list omits.
4. **Tone** is built into the tables' harmonic count, so a naive read
   would drop it.
5. **Polarity.** Windsor's Saw is a falling ramp, and its Pulse is
   `saw(p) − saw(p + width)`. The research note described a rising ramp.
6. **User waves.** One with saw-like partials builds the Saw's table, so
   "User waves pass" is unsupported.
7. **The metric** measures stationary off-harmonic energy only: no
   waveform comparison, masks that can hide aliases, DC excluded, held
   notes only, and a reference that shares the implementation.

## What was checked

- **Verified against the source** by the main session: findings 1 to 5,
  and finding 7's points about the metric.
- **Carried as assertions:** finding 6's counterexample (not measured),
  the expected audible and CPU consequences (Codex marked them expected,
  not measured), its assessment of the alternatives (an offset reset, a
  BLAMP, an edge-free table, a longer kernel), and its view that a
  four-point correction may or may not be needed.

## The most useful item

Finding 2. It is a timing bug in what shipped, independent of the saw
question, and it affected every corrected wave. Fixed in this PR's second
round: the step is now taken at the reset instant. The sine at MIDI 84
went from −37.6 to −40.8 dB of alias under the signal (README).

## The decision

tacowars, 2026-10-09:

- The direct-shape correction is not built in this round.
- The reset step's timing is fixed (finding 2).
- The Saw, Square and Pulse take the reset uncorrected, as Saw D does,
  pending tacowars's listen. The Sine, Triangle and User keep the
  correction.
- The research note fixes the polarity, reports absolute levels and states
  the metric's limits (findings 5, 6 and 7).

A restricted direct-shape correction stays a possible later ticket (record
`2026-10-09-operator-hard-sync`, decision 6).
