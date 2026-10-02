# Voice stealing: what other synths do, and the chord-pad pop

- **Date:** 2026-10-02
- **Issue:** windsor#410 (built), windsor#411 (backlog: count the limit in held notes)
- **Decision:** `docs/log/2026-10-02-voice-steals-fade-the-quietest-tail.md`
- **Test:** `packages/engine/src/synth/fmProcessorStealFade.test.ts`

tacowars allowed naming other synths in this research and in the decision's
reasoning. It is an exception for this topic, not a change to the rule.

## The problem

Ambient Evolving Strings (`str-ambient-evolve`) has a 2.8 s attack, a 4.5 s
release and `spread: 11`, so it plays two voices a note. Under a Chord
sequencer playing a C-minor triad every bar at gate 1, each hit needs 6
voices. A music part sounds at most 12 (`MUSIC_PART_MAX_VOICES`). From the
third hit on, the part steals 4 or more released tails that are still at a
good level. It faded each one over 4 ms (`Voice.steal`), and that fade was
the pop. With a pool of the limit plus 4, the fifth and sixth voices of a
hit found no free slot and cut a voice outright.

## What a stolen voice does elsewhere

Sources are pinned to the commits read.

- **Vital:** a spare voice takes the new note, then the excess voice is
  killed (released, then sustained, then held) over a **50 ms** fade. 33
  voices are preallocated and the polyphony control runs up to 32.
  [voice_handler.cpp](https://github.com/mtytel/vital/blob/636ca0ef51/src/synthesis/framework/voice_handler.cpp#L507-L528),
  [common.h L67](https://github.com/mtytel/vital/blob/636ca0ef51/src/synthesis/framework/common.h#L67).
  Its "Steal" mode instead retriggers the stolen voice's envelope from its
  current level, but resets the oscillator phase.
  [envelope.cpp](https://github.com/mtytel/vital/blob/636ca0ef51/src/synthesis/modulators/envelope.cpp#L188)
- **Helm:** a **20 ms** linear kill.
  [common.h](https://github.com/mtytel/helm/blob/abdedd527e/mopo/src/common.h#L50-L53)
- **Surge XT:** a "softkill" of the voice released longest ago (else the
  oldest held) over about **11 ms** (2^-6.5 s), from the current level along
  the release curve. At most the limit plus 3 voices may be fading; beyond
  that they are freed hard.
  [ADSRModulationSource.h](https://github.com/surge-synthesizer/surge/blob/348cfb3d0b/src/common/dsp/modulators/ADSRModulationSource.h#L378-L398),
  [SurgeSynthesizer.cpp](https://github.com/surge-synthesizer/surge/blob/348cfb3d0b/src/common/SurgeSynthesizer.cpp#L548-L605)
- **Kontakt:** a voice-stealing fade-out of 10 ms by default; the manual
  notes it can briefly exceed the voice maximum.
  [API reference](https://docs.native-instruments.com/ni-tech-manuals/kontakt-api-reference-manual/en/instrument)
- **Roland Juno-X:** voice priority LOUDEST turns off "the lowest-volume
  voice" first.
  [Parameter Guide p.16](https://static.roland.com/assets/media/pdf/JUNO-X_parameter_eng01_W.pdf)
- **OB-Xd:** released voices count as free, so the limit counts held notes,
  but a reused voice is taken over and re-attacks from its current level.
  With every voice held, the steal is legato (pitch only).
  [AdsrEnvelope.h](https://github.com/2DaT/Obxd/blob/5f8fb31c95/Source/Engine/AdsrEnvelope.h#L92-L97),
  [Motherboard.h](https://github.com/2DaT/Obxd/blob/5f8fb31c95/Source/Engine/Motherboard.h#L210-L253)
- **Dexed / MSFA:** steals key-up voices first and keeps operator phase "to
  avoid click", but resets the envelope to 0, a hard cut its own comments
  say can click.
  [PluginProcessor.cpp](https://github.com/asb2m10/dexed/blob/2e182b3db8/Source/PluginProcessor.cpp#L537-L570)
- **JUCE `Synthesiser`, Odin 2 (poly):** a hard stop, with no fade unless
  the voice adds one.
  [juce_Synthesiser.cpp](https://github.com/juce-framework/JUCE/blob/be29c81492/modules/juce_audio_basics/synthesisers/juce_Synthesiser.cpp#L525-L617)
- **DX7 (firmware 1.8):** round-robin over key-up voices; with all 16 held,
  a new note is ignored. Whether the EG attacks from its current level
  happens in the EGS chip and is unverified.
  [ROM disassembly](https://github.com/ajxs/yamaha_dx7_rom_disassembly/blob/879a25ee1c/yamaha_dx7_rom_v1.8.asm#L6442-L6475)

## Techniques, most click-free first

1. Spare voices with a longer fade (10 to 50 ms). The cost is a reserve of
   about note rate times fade time.
2. Steal the quietest voice, which only needs a level read.
3. Retrigger the stolen voice from its current level. It costs nothing, but
   the old note's pitch jumps.
4. A hard cut, which clicks.

Windsor's 4 ms was the shortest fade found. windsor#410 takes techniques 1
and 2.

## Measured

Read on an Apple M1 (macOS 26.5.1), Node 24.21.0, through the shipped
`worklet/generated/fm-processor.js` in `__fixtures__/workletHarness.ts` at
48 kHz, seed `DEFAULT_SEED`. The loop: `str-ambient-evolve`, C-minor triad
(48, 51, 55) at velocity 0.8 every 2 s (120 bpm, one bar) for 8 bars, each
note off 1 frame before the next hit.

**The metric.** The largest second difference (`x[n] − 2x[n−1] + x[n−2]`,
either channel) in the 10 ms after a hit, over the largest in the 100 ms
window from 200 ms to 100 ms before it: how much more sharply the hit moves
the signal than the pad already moves. A slow-attack pad entering adds
almost nothing, so a ratio well above 1 is the steal. The test holds every
hit to at most 2.

| Hit | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|
| Before, 12 voices | 0.75 | 11.60 | 9.81 | 10.60 | 23.59 | 4.71 | 14.07 |
| Before, 16 voices | 1.14 | 1.08 | 4.60 | 15.80 | 14.35 | 2.85 | 2.52 |
| Before, 64 voices (never steals) | 1.09 | 0.61 | 1.10 | 0.78 | 0.90 | 0.75 | 0.73 |
| After, 12 voices | 0.75 | 0.99 | 0.68 | 1.02 | 0.73 | 0.99 | 1.16 |
| After, 16 voices | 1.14 | 1.09 | 0.58 | 0.82 | 0.82 | 0.68 | 0.93 |
| After, 64 voices (never steals) | 1.09 | 0.61 | 1.10 | 0.78 | 0.90 | 0.75 | 0.73 |

Hit 1 has silence before it and is left out. Hit 2 does not steal at 12
voices, so it is unchanged. The 64-voice rows are bit-identical before and
after: a part that never steals renders the same samples.

**Hard cuts.** The test reads each voice's `active` and `voiceId` around
every block. Before, the 12-voice loop cut 12 voices (two a hit from the
third on: the pool of 16 ran out of free slots after four steals). After, it
cuts none. An eight-note chord with `spread` (16 voices a hit) at 12 voices
cut 84 before; with the reserve doubled to the limit (a pool of 24) it still
cut 6, and with the reserve at 16 (a pool of 28) it cuts none.

**Listen.** `before.wav` and `after.wav` of the 12-voice loop, dry (no
strip, chorus or plate), 32-bit float stereo, are rendered to
`~/Desktop/windsor-steal-listen/` for tacowars and are not in git.
