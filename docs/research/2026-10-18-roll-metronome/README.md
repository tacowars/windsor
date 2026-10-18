# The Roll metronome: the listen (windsor#906)

The Roll device's metronome clicks every counted beat of the song's meter,
with an accent on the bar line, on the built-in `metronome-click` patch (one
sine carrier, attack 0, a 35 ms decay to silence, velocity sensitivity 1).
The pitches and velocities are `packages/engine/src/sequencing/metronomeTables.ts`.
This note lists the listen and what it measures. The values are proposals;
tacowars listens.

| Click | Pitch | MIDI | Velocity | Level |
|---|---|---|---|---|
| Accent (bar line) | A6, 1760 Hz | 93 | 1.000 | full |
| Beat (every other counted beat) | E6, 1318.5 Hz | 88 | 0.631 | −4.0 dB |

## The listen

`listen.mjs` writes tacowars's files outside the repository; no audio is
committed:

```bash
node docs/research/2026-10-18-roll-metronome/listen.mjs [--out /tmp/windsor-906-metronome]
```

Each file is four bars of the engine's own `Metronome` on a `TickTransport`
at the file's tempo and meter, its clicks played on `metronome-click` by the
shipped FM bundle (`fm-processor.js`) with the part's voice count, bundled
from the TypeScript with esbuild. The part's output is written as it is:
live, the aux strip and aux fader are at unity and the engine's output stage
follows. Stereo, 48 kHz, 16-bit, with a 0.5 s tail.

The files, in `/tmp/windsor-906-metronome/`:

- `metronome-4-4-125bpm.wav`: 4/4 at 125 BPM, 16 clicks. Each bar: A6 on
  beat 1 (the accent), E6 on beats 2, 3 and 4.
- `metronome-7-8-125bpm.wav`: 7/8 (2+2+3) at 125 BPM, 12 clicks. Each bar:
  A6 on tick 0 (the accent), E6 on ticks 24 and 48.
- `metronome-6-8-110bpm.wav`: 6/8 at 110 BPM, 8 clicks. Each bar: A6 on
  tick 0 (the accent), E6 on tick 36.

None clips and none holds a non-finite sample.

## What it measures

The script prints each file's clicks and the envelope of bar 2's accent and
of its first other beat, on the left channel. On the shipped FM bundle, at
48 kHz, the same in all three files:

| Click | Peak | Time to peak | −20 dB point | Under −60 dB by |
|---|---:|---:|---:|---:|
| Accent | 0.561 | 0.15 ms | 29.7 ms | 34.9 ms |
| Beat | 0.354 | 0.19 ms | 29.8 ms | 34.8 ms |

- **Accent to beat:** 0.354 / 0.561 is −4.0 dB, the table's
  `BEAT_BELOW_ACCENT_DB`, since the carrier's velocity sensitivity of 1 makes
  its amplitude the velocity itself.
- **Decay:** the envelope lands the patch's 35 ms decay with no tail.

## Files

- `README.md`: this note.
- `listen.mjs`: the listen.
