# Chorus is the second insert kind, and the fake graph learns audio-rate modulation

- Date: 2026-09-22
- Area: audio
- Links: issue #642 · epic #637 · builds on `2026-09-22-641-strip-inserts-over-a-code-owned-registry`

## Decision

1. **Chorus, all native nodes.** Two voices, each a pair of `DelayNode`s:
   - Each voice's delays sit at a centre (11 ms and 17 ms). The voice's sine
     `OscillatorNode` swings them by ±Depth through a gain into `delayTime`,
     and `DelayNode` interpolates the fractional delay, so the pitch wobbles.
   - The second voice's LFO runs at 1.37× the first, so the two never line up.
   - The stereo signal is split into its two channels, each delayed by its own
     line. **Spread** sets the right line's LFO gain to `1 − 2·spread` of the
     left's: 0 moves the sides together, 1 moves them in opposite directions.
     That's width without a `StereoPannerNode`, whose balance law collapses a
     stereo signal (mixer record §4).
   - **Mix** is a parallel dry path, and the wet level is shared across the
     voices.
   - Ranges: Rate 0.05–5 Hz (default 0.6), Depth 0–4 ms (default 2),
     Spread 0–1 (default 0.7), Mix 0–1 (default 0.5).
   - The LFOs run free, unsynced to the transport.
   - The voice count is the kind's, so `set` is param writes only. `dispose`
     calls `stop()` on every oscillator, since a running source keeps its
     subgraph alive, and disconnects what the stage built, including the
     connections into the delay parameters.
2. **The registry held.** Adding chorus touched `inserts/chorusInsert.ts`, its
   constants and one `INSERT_KINDS` entry; in the console, `chorusCard.ts`, its
   knob entries and label, and one `INSERT_CARDS` entry; plus two export lines
   in each engine index. The strip, the normaliser, the live path and the
   Mixer tab needed no edit, so #641's contract needed no fix. TypeScript
   refused the console until chorus had a card and a label, before any test
   ran.
3. **The fake graph now models audio-rate modulation.** The chorus's sound can
   only be tested if a parameter can be modulated, so
   `__fixtures__/fakeAudioNodes.ts` gains:
   - a sine `FakeOscillator` that records `start()` and `stop()`;
   - `connect(param)`, where a `FakeParam`'s connected nodes are summed onto
     its value per sample, as the spec has it (`valuesAt`);
   - a `FakeDelay` whose time, when modulated, is read per sample with linear
     interpolation between ring samples.

   An unmodulated delay renders exactly as before, so every existing
   graph test is unchanged.
4. **`MS_PER_SECOND` comes from `timeConstants.ts`**, the client's one
   definition, rather than a third copy in the insert table.

## Why

Chorus was the ticket that tested whether #641's registry makes a new effect
a new file. It did, and the record says what it cost. The fake-graph
extension is the only way to test a modulation effect's sound without a
browser. Keeping it to the spec's arithmetic means the tests exercise the
same model the real `DelayNode` implements.

Measured through the fake graph (`inserts/chorusInsert.test.ts`):
- At Mix 0 the output is the input, sample for sample.
- With Depth 4 ms and Rate 4 Hz, a steady 440 Hz tone grows sidebands at each
  voice's LFO rate above 2 % of the input's amplitude. At Depth 0 the same
  bins read about 100× lower. Levels are read through a Hann window, because
  unwindowed, the tone's own leakage four hertz away (≈ 1.4 %) would have
  passed for a sideband.
- At Spread 0 the two sides are identical; at Spread 1 they differ.

## Punted / alternatives

- **More than two voices, or a voice-count field.** A count field would mean
  a structural rebuild on a knob turn. Two voices is the classic stereo
  chorus.
- **Transport-synced LFOs.** Not what a chorus wants. A tempo-locked flanger
  or vibrato would be its own kind.
- **Cost.** Four interpolating delay lines and two oscillators per chorus,
  all native, and invisible to the audio-load meter. A reading at
  `MAX_INSERTS` of chorus on every strip belongs to the next audio milestone
  on the target box (CLAUDE.md invariant 3).
