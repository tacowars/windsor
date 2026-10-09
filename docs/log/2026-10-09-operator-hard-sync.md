# Operator hard sync and a ratio target

- **Date:** 2026-10-09
- **Status:** accepted (the decisions of windsor#646). Decision 13's
  measurement raised `needs-human` on the saw; tacowars decided it on
  2026-10-09, and decision 6 records what ships
- **Links:** windsor#646 · its measurements in
  `docs/research/2026-10-09-operator-hard-sync/README.md` and the Codex
  consult beside them (`codex-consult.md`) · the console's
  Sync picker and LFO Ratio knobs are a later build ticket

## Context

An operator's phase runs free. Hard sync restarts it on every wrap of a
master's phase. Sweeping the synced operator's ratio while its period stays
locked gives the classic tearing sync sound. Syncing to the note makes any
ratio harmonic, so a ratio like 2.37 becomes a pitched, formant-like tone
rather than a bell.

No operator ratio could be modulated: the operator targets were `level`,
`env.decayTime`, `env.decayCurve`, `feedback` and `width`. A sync sweep
needs one.

## Decision

1. **The field.** `Operator.sync: OpSync`, where
   `type OpSync = 'off' | 'note' | 'A' | 'B' | 'C' | 'D'` and the letters
   are `OP_NAMES`. The default is `'off'`. It is a string, so a later
   master is an additive value. The values are `OP_SYNC_VALUES` in
   `worklet/fm/patchDefaults.ts`, and `patch.ts` and the engine index
   re-export the type and the list.
2. **What resets.** The synced operator's own phase accumulator, the value
   `phaseInc` advances, never its modulated read. Phase modulation it
   receives still applies on top of the reset phase.
3. **When it resets: on the master's own-phase wrap, at its sub-sample
   position.**
   - `'note'`: a per-voice note phase advanced by `baseFreq / sr`, with
     `baseFreq` as the control update computes it (glide, bend, voice
     detune, the pitch envelope and both LFOs' `toPitch`). It starts at 0
     on a note-on and keeps running through a legato retarget.
   - `'A'`–`'D'`: that operator's own accumulator, whatever its level,
     wave, fixed mode or detune. A master at level 0 still syncs. FM on a
     master never moves its wraps.
   - Where the master wrapped `d` of a sample ago (its phase after the
     wrap over its increment), the synced operator's phase becomes `d`
     times its own increment.
4. **Chains and cycles.** A chain such as C → B → note is allowed. A forced
   reset counts as a wrap for the operators synced to the reset one, and
   resets run in chain order within the sample.
   - A cycle, one operator synced to itself included, is normalised to
     `'off'` on every operator in it. An unknown value is `'off'` too.
   - An operator that leads into a cycle without being in it keeps its
     master.
   - `normaliseOpSyncs` in `patchDefaults.ts` is the one rule, read by the
     worklet's normaliser and by `makePatch()`.
5. **Where sync does nothing.**
   - A synced Noise operator: its draw has no phase, so its voice keeps the
     kernel and sounds as it did.
   - A Noise operator as a master syncs by its phase accumulator, which
     the generic loop advances like any other (checked, see the research
     note).
   - A fixed-frequency operator syncs normally, as the synced operator or
     as the master.
6. **Anti-aliasing: a two-sample polyBLEP on the reset's step, on the
   Sine, Triangle and User waves.**
   - **The step.** Taken at the reset instant, in time order: the wave at
     phase 0 less the wave at the free-running phase just before the
     reset. That phase is where the operator stood `d` of a sample before
     the next sample, so a wrap it made earlier in the interval counts and
     one the reset forestalled does not. Both reads take the sample's
     phase modulation and width, after the width squeeze, before the
     operator's own filters and its level. (The first round read the two
     phases a sample on, which is wrong when the free-running phase wraps
     inside the interval.)
   - **The delay.** A corrected operator's output reaches everything it
     feeds a sample late, so the sample before the reset can be corrected.
     Its feedback taps keep the raw, undelayed wave. An uncorrected
     operator is not delayed.
   - **The corrected waves.** Sine, Triangle and User.
   - **Uncorrected, pending tacowars's listen.** Saw, Square and Pulse take
     the reset uncorrected and undelayed, as Saw D, Square D, Sine 4bit and
     Sine 8bit do. Their tables' own edge is centred on phase 0, where a
     reset lands, so a step read from the table misses most of the jump.
     The Pulse's two saw reads follow the one accumulator, so they reset
     together.
   - **Not built.** No BLAMP, no minBLEP, and no direct-shape correction.
   - **A possible later ticket**, if tacowars hears the saw's aliasing: a
     restricted direct-shape correction, the ideal wave with a polyBLEP on
     each edge. Only for an operator that is unmodulated, unfed (no
     feedback) and unsqueezed, at Tone 1; with Windsor's polarity (the Saw
     a falling ramp, the Pulse `saw(p) − saw(p + width)`); and judged
     against an absolute alias target, not only an improvement over the
     uncorrected table.
   - **The constant.** `SYNC_BLEP_GAIN` in `fmConstants.ts`.
7. **The fast path is untouched.** A voice with any synced operator renders
   through the generic loop: `bindVoiceConstants` adds the condition to
   `voice.kernel`. `voiceKernel.ts` is not edited. With every operator at
   `'off'` the output is bit-identical, and the goldens' existing rows do
   not change.
8. **The generic loop's rules hold.**
   - **Its own module.** The sync state, the binding, the chain order and
     the reset live in `worklet/fm/voiceSync.ts`.
   - **No call on a quiet sample.** The loop advances the note phase and
     tests each master's wrap inline, and calls `applySyncResets` only on a
     sample where one wrapped.
   - **Allocation free.** Nothing allocates, and no double crosses a call.
9. **The ratio target.** Each operator gets a row `ops.<i>.ratio`, its
   sixth, so the five before it keep their offsets.
   - **The row.** Curve `ratio`, bounds and floor from `RATIO_RANGE`
     (0.0625 to 24), the console's former `RATIO_MIN` / `RATIO_MAX`, now in
     `patchDefaults.ts` and exported through the index for `ratioSplit.ts`.
     The span is half the knob's travel in octaves, and `slideKeeps` is
     false.
   - **Its look.** `Ratio` on a log scale in the automation catalog.
   - **Where it is read.** Where the frequency is worked out. A
     fixed-frequency operator ignores it.
   - **Moved codes.** Persisted targets are path strings, so the insertion
     moves only runtime codes.
10. **The LFOs' ratio routing.** `LfoSettings.toRatio: number[]`, one depth
    per operator in octaves, on both LFOs.
    - **Range.** −4 to 4, which the worklet clamps; the default is 0.
    - **The arithmetic.** It multiplies a ratio operator's frequency by
      `2^(lfo × depth)`, after the ratio target, at control rate.
    - **Where it does nothing.** A fixed-frequency operator ignores it.
    - **The control interval.** A non-zero depth follows the
      control-interval rule an LFO on pitch does.
11. **No format bump.** `sync` and `toRatio` are additive fields whose
    defaults reproduce today's sound. `PATCH_FILE_FORMAT` and
    `ARRANGEMENT_VERSION` are unchanged, and there is no migration. A patch
    file and a song's patch snapshot round-trip both fields.
12. **Two factory patches.** Both are two-operator leads:
    - `lead-sync-sweep`: a saw synced to the note, its ratio swept 1.25–5
      by LFO 1's `toRatio`, over a sine at the note.
    - `lead-sync-detune`: a saw synced to a sine six cents above the note,
      its ratio swept from 6 to 1.5 on each note by a one-shot LFO 2.
13. **Measured, never estimated.** The research note records the folded
    alias of a synced saw and sine at MIDI 84, ratio 3.7, 48 kHz, with and
    without the polyBLEP, against a 16× reference. It also records a synced
    voice's CPU against the same voice unsynced. If the polyBLEP removes
    less than 10 dB, `needs-human` is raised before anything better is
    built.

## Consequences

- **The kernel test.** `fmProcessorKernel.test.ts` held every preset to
  the kernel. Decisions 7 and 12 together put two presets on the generic
  loop in both runs, and the test now expects the kernel only for a preset
  with no synced operator.
- **The golden tables.** Both gained a row for each new preset. No existing
  row moved.
- **The polyBLEP's measurement.** In the first round, which read the step
  a sample on and corrected every table wave, it removed 12.8 dB on a
  synced sine and −0.1 dB on a synced saw at MIDI 84, ratio 3.7, and made a
  Pulse 4.8 dB worse.
  - **The cause.** A band-limited saw's edge sits at phase 0, where a reset
    lands, so the table read there misses most of the jump.
  - **The decision.** The PR raised `needs-human`, and a Codex consult
    found the step's timing bug. tacowars decided on 2026-10-09: fix the
    timing, correct only the Sine, Triangle and User, and build nothing
    better now (decision 6).
  - **As shipped.** At MIDI 84 a synced sine sits at −40.8 dB of alias
    under the signal (−24.8 uncorrected) and a saw at −26.5 dB,
    uncorrected. The research note has the table at four notes and the
    metric's limits.
- **The two factory leads.** Both sync a saw, which is now uncorrected, so
  their golden rows changed in the second round.
- **The CPU.** A synced voice costs 2.3 to 3.3 times the same voice
  unsynced, almost all of it the generic loop. A kernel path for synced
  voices would be its own ticket.
