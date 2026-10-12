# The plate's Decay in seconds, and the render it moves

- **Date:** 2026-10-12
- **Status:** accepted with windsor#748 (PR windsor#750); tacowars ruled on
  the deviations and the ceiling on 2026-10-12
- **Links:** issue windsor#748 · the plan
  `docs/research/2026-10-11-plate-reverb-upgrades/README.md` §1 and §6 ·
  the measurements `docs/research/2026-10-12-plate-decay-seconds/README.md` ·
  format rules in `2026-09-28-format-versions-refuse-never-destroy` · the
  Size-sweep test in `2026-08-31-dattorro-reverb-not-plateau` §3

## Context

The plate's `decay` was a feedback gain from 0 to 1. The same setting rang
longer in a bigger tank, and no setting read as a time. The plan's §1 makes
Decay an RT60 in seconds, charged on every segment of the loop, and adds a
low band (`lowDecay`, `lowCross`) so the lows can ring longer or shorter
than the rest. Its §6 makes the Plate insert's Mix equal-power. windsor#748
ships the two together, because they share one format bump.

All three change what the plate renders:

- Each tank line now has a gain point `g = 10^(−3L / (Decay·fs))` for its
  own length at the block's Size, set once a block and ramped across it,
  through a measured correction (`worklet/reverb/reverbDecayTables.ts`).
  This replaces the single feedback gain at the long lines.
- The low band is a first-order shelf at each gain point. At `lowDecay`
  exactly 1 it does not run, and the render is bit for bit the render
  without its code.
- The Plate insert's Mix is wet `sin(mix·π/2)`, dry `cos(mix·π/2)`. The
  ends are unchanged.

## Decisions

1. **The reverb golden is re-pinned on purpose.**
   `__fixtures__/reverbGolden.json` was refreshed with
   `A204_REFRESH_REVERB_GOLDEN=1`, because the tank's gains changed
   meaning. Of `main`'s fifteen scenarios, thirteen moved: `decay-long`,
   `decay-short`, `filters-and-modulation`, `hold-released`, `impulse`,
   `max-diffusion`, `size-and-decay`, `size-box`, `size-cathedral`,
   `size-glide`, `sleep`, `sleep-and-wake` and `wet-late`. Two kept their
   hashes: `dry-only`, which never reaches the tank, and `hold`, because a
   held tank keeps the old gains (`HOLD_DECAY` at the long lines, the
   all-passes untouched). Three scenarios were added: `low-band`,
   `low-band-moves` and `decay-step`. The old decay values in the scenarios
   became seconds. `fmProcessorGolden` did not move, and the Retro Reverb's
   tests pass untouched.
2. **`ARRANGEMENT_VERSION` goes from 10 to 11, with no upgrade.** `decay`
   changed meaning, and converting an old gain to seconds would need a
   measured table per Size and diffusion. A song saved at version 10 or
   earlier is refused with the standard format message. `songMigrations.ts`
   keeps its steps up to 10, which no longer reach 11.
3. **The low band holds its times three octaves from `lowCross`, not one.**
   The first-order split that the issue prescribes moves a shelf's log gain
   `1/(1+(f/fc)²)` of the way, so one octave out the band is 37 % short at
   `lowDecay` 4. Three octaves out it is within 2 % of its target. Meeting
   the issue's one octave would need a steeper split. tacowars accepted
   this.
4. **The spaces are converted from measurement.** Each row's `decay` is its
   broadband T30 on `main`, rounded to 0.05 s. Two rows differ from that
   rule:
   - **`shimmer` takes 5.05 s**, not its rounded old T30 of 4.35 s. At
     4.35 s its 250 Hz tank low cut left it 12.6 % short. 5.05 s measures
     its old T30 to within 0.3 %. tacowars accepted this.
   - **`cathedral` and `wash`** measured 30.4 s and 31.4 s on `main`. The
     PR first held them at the 20 s ceiling, 38 % and 48 % short. With the
     ceiling at 60 s (decision 6) they take their measured T30, 30.40 s and
     31.35 s, like the other rows. `cathedral` now measures 28.1 s (−7.4 %).
     `wash` measures 23.1 s (−26 %), because its 200 Hz tank low cut and
     5 kHz high cut cost a long tail more than a short one. tacowars ruled
     that neither gets further tuning (decision 7).
5. **Two corner misses are accepted.** tacowars accepted both:
   - **Decay 0.2 s at Size 0.05** measures up to +14.5 %. The floor is the
     input diffusers' own ring, which sits outside the loop.
   - **The fast Size ramp** (0.05 → 4 → 0.05 over 2 or 4 s each way) fails
     the no-step test. That is Doppler, not a step, and `main` does the
     same once its tail is as long. The 8 s ramp passes and is pinned.
6. **Decay's ceiling is 60 s, not 20.** Under the old feedback gain there
   was no time ceiling: Decay 1 sustained, and `cathedral` and `wash`
   measured about 30 s. A 20 s top took range away. `REVERB_SPACE_RANGES`
   and the processor's descriptors both read `[0.2, 60]`, and the knob and
   the automation row follow them. The correction table gained 30, 40 and
   60 s columns, measured the same way as the others in one run that
   reproduced every earlier cell. Near 60 s at the smallest Sizes three
   fixed-point steps had not converged, so a cell now keeps stepping while
   it is more than 1 % off. That changed six new cells and none of the
   earlier ones. No pinned golden row moved: every scenario's Decay is 20 s
   or under, where the table is unchanged, so `reverbGolden` was not
   re-pinned again.
7. **The `SPACES` rows are transitional.** Item 8 of the plan replaces them
   with a new preset bank, and tacowars does not plan to keep `cathedral`,
   `shimmer` or `wash`. Their values here only carry today's sound across
   the format change.

## Consequences

- Every song saved before version 11 is refused. A song that wants its
  plate back re-enters it on the new scale.
- The plate's sound changes wherever the tank runs, and tacowars listens on
  the PR preview before it merges.
- At the 60 s top every gain point stays under 1, and the longest corner
  (Decay 60 s × `lowDecay` 4, tank diffusions 0.8, Size 4) decays to the
  sleep floor within 3 × 240 s. HOLD and a Decay step from 0.2 to 60 s and
  back pass the no-step test.
- **Open, for tacowars:** the 60 s top adds a corner miss. At Size 0.05,
  T30 tracks Decay to within ±10 % at 48 kHz but for three cells with a
  second tank diffusion of 0.8 (up to +11.6 %). At 44.1 kHz it runs short
  from 30 s (up to −25 % at 60 s), because the table was measured at
  48 kHz. Size 0.08 and up holds ±10 % at both rates. A second table
  measured at 44.1 kHz would close the 44.1 kHz miss.
