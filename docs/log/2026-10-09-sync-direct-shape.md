# A direct shape for the synced Saw, Square and Pulse

- **Date:** 2026-10-09
- **Status:** accepted (the decisions of windsor#655)
- **Links:** windsor#655 · the study it builds, candidate A + D of
  `docs/research/2026-10-09-sync-antialias-study/README.md` (windsor#652),
  and its reference implementation `directBundle.mjs` · the consult's
  pitfalls, `docs/research/2026-10-09-operator-hard-sync/codex-consult.md`
  · hard sync itself, `2026-10-09-operator-hard-sync` · this build's
  measurements, `docs/research/2026-10-09-sync-antialias-build/README.md`
  · the 2× synced voice that completes the fix, windsor#656

## Context

Hard sync shipped with the Saw, Square and Pulse taking the reset
uncorrected (`2026-10-09-operator-hard-sync`, decision 6). Their tables'
own edge sits at phase 0, where a reset lands, so a step read from the
table misses most of the jump. On `lead-sync-sweep` the alias sits at
−32.0 dB under the signal at MIDI 72 and −28.4 dB at 84 (the study's
framed median).

tacowars chose candidate AB2 + D of the study on 2026-10-09: a direct
shape with a two-point polyBLEP on every edge, run inside a 2× voice, with
the fine control interval for a voice whose ratio is modulated. This
record is the first half, A + D. The 2× voice is windsor#656; the two
were split because together they pass the size limit for interacting work.

## Decision

1. **Who takes the direct shape.** A synced Saw, Square or Pulse operator
   when all of these hold:
   - **No modulator edge into it in the algorithm.** A modulator slot
     counts even at Level 0, because a lane or macro can raise it
     (consult finding 1).
   - **The patch's Tone is 1.** Tone is built into the tables' harmonic
     count (consult finding 4).
   - **Its live feedback is exactly 0 across the control block, and a Saw's
     or Square's live width is exactly 1 and not ramping** (consult finding
     3). A Pulse's width is its duty and is allowed. "Live" is what the
     block plays: the patch, a step, a song lane, a macro and the LFOs'
     `toWidth`.

   The first two are decided at the bind (`syncShapeKind`, from
   `bindVoiceSync`). The live values are re-checked at the start of every
   render call, so at least every control block (`beginSyncShapeBlock`). An
   operator that stops qualifying reads its table from that block on, and
   takes the shape again when it qualifies. Every other synced operator
   keeps its path: the Sine, Triangle and User keep their correction, and
   Saw D, Square D and the bit-crushed sines stay uncorrected.
2. **The shape and its level**, in Windsor's polarity (consult finding 5):
   - the Saw: `g·π/2·(1 − 2p)`, a falling ramp;
   - the Square: `±g·π/4`, high for the first half;
   - the Pulse: `saw(p) − saw(p + w)`, which is `g·π·w` up to phase `1 − w`
     and `g·π·(w − 1)` after.

   `g` is the fundamental of the operator's current table, which is
   `1 / peak` of its Fourier series. It is read when the table changes,
   from `TABLE_SIZE` points at the table's own stride, so the level follows
   the mip as the table path's does, at any table length (decision 9). The
   shape's peak is about 15 % (1.4 dB) under the table's at the same
   harmonic levels, because the table is normalised to its Gibbs overshoot.
   That is accepted: anything after the operator that reacts to peaks, the
   drive stage first, bites a little less.
3. **The edges, in time order**, after each sample's resets
   (`syncShapeEdges`), between the sample just read and the next:
   - the wraps and duty edges on the free-running path up to the reset, or
     over the whole interval when there is none;
   - the reset's step, from the left limit at the free-running phase just
     before it to the wave at phase 0 (consult finding 2);
   - a duty edge after phase 0 and by the next sample.

   Each takes the two-point polyBLEP that the corrected waves use
   (`SYNC_BLEP_GAIN`): an edge of step `h` falling `dd` of a sample before
   the next sample adds `h·dd²/2` to the held sample and takes
   `h·(1 − dd)²/2` off the next. Corrections in one interval sum; none
   overwrites another. The operator's wave goes on a sample late, through
   the corrected waves' delay (`VoiceSync.held`, `after`).
4. **D, the fine control interval.** A voice keeps `CTRL_INTERVAL` while
   its ratio is modulated (`voiceControlInterval.ts`):
   - an LFO's `toRatio` that is not 0 on any operator, whatever its rate,
     shape or depth;
   - a song lane's offset that is not 0 on any `ops.<i>.ratio` row, or on a
     macro that maps one.

   A step's push on a ratio is fixed for the note, so it steps nothing and
   does not count. Without D the ratio steps every 128 samples, and the
   stepping alone sits at about −43 dB, under which no anti-aliasing helps.
   D applies to any voice, synced or not: an unsynced operator whose ratio
   an LFO moves steps its pitch the same way.
5. **The switch between the shape and the table.** An operator the bind
   lets take the shape sends its wave a sample late on both paths, so a
   switch neither skips nor repeats a sample. Leaving the shape, it drops
   what its next sample still owes an edge, which the band-limited table
   already has. Entering it, an edge in the one interval before the switch
   goes uncorrected. Both paths carry the same harmonics, so a switch does
   not click.
6. **What stays put.** Unsynced voices take the kernel, which is not
   edited, and every factory preset except `lead-sync-sweep` and
   `lead-sync-detune` renders bit for bit as before. Those two take the
   shape, and their golden rows change.
7. **The table read at a reset (decision 9 of the issue).** Since
   windsor#650 a mip table holds from 2048 to 16384 samples. The reset
   correction's read for the Sine, Triangle and User (`syncWaveAt`) now
   scales its phase by the table's own `length − 1`, not by `TABLE_SIZE`.
   A Sine's table holds one harmonic and is always 2048 long, so the fix
   reaches the Triangle and the User waves on a low note.

## Consequences

- `lead-sync-sweep` measures −36.8 dB at MIDI 72 and −33.1 dB at 84,
  the study's A + D row to the tenth. Its CPU is 1.43 times shipped's on
  one voice. The figures, the machine and the waveform checks are in the
  build's research note.
- An unsynced voice whose ratio an LFO moves now updates its controls four
  times a quantum. On `lead-sync-sweep` with its sync off that costs about
  10 ns a sample.
- A phase-modulated, fed, squeezed or Tone-reduced synced Saw, Square or
  Pulse keeps aliasing as before. windsor#656's 2× voice gives most of
  those about 7 dB (the study's decision 5 table); a fed one changes its
  sound there instead.
