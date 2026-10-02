# A Formant mode for the voice filter

- **Date:** 2026-10-02
- **Status:** accepted (the decisions of windsor#331, the engine half; the
  editor's Vowel knob is a second ticket)
- **Links:** windsor#331 · `docs/design/audio-architecture.md` ("voice-like
  formants") · the cost, makeup and audition in
  `docs/research/2026-10-02-formant-filter/README.md`

## Context

Choirs, "ah" pads and chant voices are what both Glass- and Reich-style
pieces call for, and the design doc names voice-like formants as a goal.
The nearest the engine had was one bandpass whose single peak moves with
the note (`ai-voice`, `score-ghost-formants` and the other voice-like
presets): a vowel is two or three peaks that stay put while the pitch
moves, and one moving peak is neither.

## Decisions

1. **The mode.** A sixth filter mode, `FILT_FORMANT = 5` (`modeIds.ts`),
   `FILTER_MODE.FORMANT`, named `'Formant'` at the end of
   `FILTER_MODE_NAMES`. The console's filter-mode segment lists the names,
   so it shows Formant from this change; the Vowel knob comes with the
   editor ticket.
2. **The patch field.** `FilterSettings.vowel`, 0–4 continuous, default 0:
   0 a, 1 e, 2 i, 3 o, 4 u, a fraction morphing linearly between two
   neighbours. The worklet clamps it to `VOWEL_RANGE` and, from now on,
   plays a `mode` outside 0–5 as Off (what an unknown mode already sounded
   like). `makePatch` and both normalisers fill it from `FILTER_DEFAULTS`.
3. **The vowels.** `formantTables.ts`: each vowel's first three formant
   centres (Hz) and levels (dB), the bass voice of the Csound Manual's
   "Formant Values" (a 600/1040/2250 Hz at 0/−7/−9 dB, and so on). The
   peaks share one Q, `FORMANT_Q_PER_RESONANCE` (8) per unit of
   `resonance` (the default 0.707 is Q 5.66), capped at `FORMANT_Q_MAX`
   (40). Each peak's gain is its level × `FORMANT_MAKEUP` / Q, so it stands
   at its level whatever the Q (an SVF bandpass peaks at Q; the division is
   by the section's own `1 / max(0.5, q)`, the same for every resonance
   above 0.0625). `FORMANT_MAKEUP` is measured, 1.787: white noise through
   "a" at the default resonance sits at the RMS of white noise through the
   Bandpass mode at the same resonance and a 1 kHz cutoff. The reference
   needs a cutoff; 1 kHz is in the vowels' range, where a patch moving from
   one bandpass to Formant has its peak (against 8 kHz the makeup would be
   3.78, and an FM voice 6.5 dB louder on the switch).
4. **Control rate.** In Formant mode `updateVoiceFilter` works out the
   filter's modulation as for every mode (envelope, wheel, both LFOs, key
   track, the part's cutoff control) and hands its `2^octaves` to
   `updateVoiceFormant` (`voiceFormant.ts`) in a slot, in place of moving
   `cutoff`: the three centres are the vowel's morphed row times it, so the
   modulation moves all three together, and key track 0 leaves them where
   the table puts them at every note. The levels morph in dB, then become
   gains. The vowel is the bound patch's (no step or lane moves it yet). A
   section whose centre and Q are unchanged keeps its coefficients, and an
   unchanged level its power of ten, so a held vowel pays no `Math.tan` or
   `Math.pow` a block.
5. **The filters.** The voice gains a third section, `svfC`, allocated and
   reset with the other two; each section carries its Formant peak's gain.
   In Formant mode the three run in parallel from the same input in
   bandpass, `out = gA·A(in) + gB·B(in) + gC·C(in)`, summed in that order,
   in both render loops inside the filter's branch, ahead of the serial
   path, which is untouched. Each bandpass is `Svf.process`'s arithmetic
   written out, not called: with three more inlined calls the kernel's
   inlining budget ran out, and a Formant voice anywhere in the bundle made
   every other voice about 25 % slower, Off included (the research note).
   `slope24` and `cutoff` are not heard in this mode; the peaks are 12 dB
   bandpasses. A Formant voice's filter is quiet for dormancy and its end
   only when all three sections are.
6. **Formats.** Both changes are additive and their defaults reproduce the
   old sound (`vowel` 0 is not heard outside Formant; no saved patch used
   mode 5), so neither `PATCH_FILE_FORMAT` nor `ARRANGEMENT_VERSION` moves
   (`2026-09-28-format-versions-refuse-never-destroy`). Library files are
   not rewritten: a missing key passes the shape check and fills from the
   defaults. The FM goldens did not move.

## Consequences

- A voice in Formant mode runs three sections: its filter costs about
  1.4–1.5× the 24 dB pair's, its whole voice about 1.1× the same voice at
  24 dB (Apple M1, Node 24, in the research note). Every other mode costs
  what it did.
- `slope24` and `cutoff` are unused in Formant mode; the console still
  shows their controls.
- Summed, each peak's skirt adds to its neighbours': at the default Q the
  third peak of "a" sits 1.9 % above its table centre and F2 and F3 are
  0.5–0.7 dB above their levels; at high Q they are where the table puts
  them.
- The vowel is static per patch. Moving it from an LFO, a step lane or a
  song lane is a later ticket, as is the editor's Vowel knob.
