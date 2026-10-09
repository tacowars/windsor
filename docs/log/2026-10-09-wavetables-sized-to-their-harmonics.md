# Each octave's wavetable is sized to the harmonics it holds

- **Date:** 2026-10-09
- **Status:** proposed (tacowars's direction of 2026-10-09: fix the table
  oscillator's floor now; leave the voice drive's anti-aliasing for later)
- **Links:** the measurements in
  `docs/research/2026-10-08-wavetable-floor/README.md` · the drive study
  that found the floor, `docs/research/2026-10-08-voice-drive-aliasing/README.md`

## Context

Every table wave (Saw, Square, Triangle, Pulse, User, the sines) is one
band-limited table per octave from `MIP_BASE_HZ`. Until now each table had
2048 samples, read with linear interpolation. Interpolating leaves images
of a table's harmonics, which fold back below Nyquist as an inharmonic
floor. The more harmonics a table holds for its length, the louder the
floor. The lowest octave's saw holds 733 harmonics in 2048 samples. On the
shipped engine, a plain saw with no drive and no filter read a floor of
−35 dB A-weighted against the note at C0–B1, about −54 dB at C2, −62 dB at
C3 and −77 dB at C4. The low octaves also lost up to 3.9 dB on their top
harmonics. A summed band-limited saw reads −91 dB on the same meter.

## Decisions

1. **A table's length follows its harmonics.** Each octave's table is the
   smallest power of two at least `MIP_TABLE_RATIO` (22) times its highest
   non-zero harmonic, from `TABLE_SIZE` (2048) to `TABLE_SIZE_MAX` (16384),
   both in `fmConstants.ts`. A saw at tone 1 gets 16384, 8192 and 4096
   samples for its three lowest octaves and 2048 for the rest; a lower
   `tone` holds fewer harmonics and gets shorter tables.
   - With this, no octave's worst note reads above −72.5 dB, against −35 dB
     before, for Saw, Square and Pulse alike. The harmonic levels come
     within 0.06 dB of exact.
   - A fixed 16384 for every table reads the same, but costs 786 KB per
     wave against 184 KB. A cubic read on 2048 samples only reaches −39 dB
     at its worst note.
2. **Short tables keep their bits.** A table that stays at 2048 is summed
   exactly as before, so a sine, every octave from about C3 up, and a
   sparse User wave render as they did. Only patches that read a grown
   table change: 41 factory presets. Both FM goldens are refreshed on Node 24.
3. **Long tables are built by an inverse FFT** (`waveTableFft.ts`). The
   worklet builds an uncached wave on the audio thread when a patch arrives.
   Summed, a saw's set at the new sizes took about 34 ms. By the FFT it
   takes about 3 ms, less than the old 2048-sample set's 6 ms. Its twiddles
   are Float32 sines read at a stride, so they carry the same platform risk
   as `SIN_TAB`, and no new transcendental call is made per sample.
4. **The loops read each table's own length.** The kernel hoists each
   operator's `tX.length - 1` once per render call, and the generic loop
   reads `t.length - 1` at its table reads. A table of 2048 gives the same
   product as `TABLE_SIZE` did, so nothing there changes to the bit. The
   voice gains no state, and `SIN_TAB` and the LFO's sine stay at 2048.
5. **No format version.** This changes the render, not the patch or song
   document, so `PATCH_FILE_FORMAT` and `ARRANGEMENT_VERSION` stay.

## Consequences

- Low saws, squares and pulses lose an audible hash and gain up to 3.9 dB
  on their top harmonics: a bass on any of them sounds a little brighter
  and cleaner. Notes from about C3 up are unchanged.
- A wave set's memory roughly doubles, to 184 KB for a saw at tone 1. With
  the cache's 64 entries, the worst case is about 12 MB, against 6 MB.
- The voice loop's measured cost did not move on a bass held at C1–C3:
  ratio 1.00 interleaved on Node 24. On the windsor#548 bank it read
  within its scatter, at most about 3 % (the research note).
- A listening check by tacowars is still owed: the change is audible by
  design on low notes.
