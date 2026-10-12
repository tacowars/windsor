# The plate's Decay in seconds, and the render it moves

- **Date:** 2026-10-12
- **Status:** accepted with windsor#748 (PR windsor#750); tacowars ruled on
  the deviations, the ceiling and the Size 0.05 corner on 2026-10-12
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
5. **Three corner misses are accepted.** tacowars accepted all three:
   - **Decay 0.2 s at Size 0.05** measures up to +14.5 %. The floor is the
     input diffusers' own ring, which sits outside the loop.
   - **The fast Size ramp** (0.05 → 4 → 0.05 over 2 or 4 s each way) fails
     the no-step test. That is Doppler, not a step, and `main` does the
     same once its tail is as long. The 8 s ramp passes and is pinned.
   - **Size 0.05 from Decay 30 s.** A 36 ms tank asked to ring for a
     minute loses nearly all of it to its own passes, so the correction
     there is large (5.58 at 60 s). At 48 kHz T30 tracks Decay within
     ±10 % but for three cells with a second tank diffusion of 0.8 (up to
     +11.6 %). At 44.1 kHz it runs short from 30 s (up to −25 % at 60 s),
     because the table was measured at 48 kHz. Size 0.08 and up holds
     ±10 % at both rates. No 44.1 kHz table is built. The low band's own
     correction (decision 8) reads the same 48 kHz table, so a long low band
     at Size 0.05 runs short at 44.1 kHz the same way: the 60 s band of the
     test in decision 8 measures 47.9 s there (−20 %), 60.6 s at 48 kHz.
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
8. **The low band takes the correction at its own target** (fix round 2,
   from Codex's review). Fix round 1 cut the band's gains from the
   broadband Decay's corrected value times `lowDecay`, so the factor it
   used was the one for Decay, never for the band's own RT60. The factor
   climbs with the RT60 asked, steeply at small Sizes, so a long low band
   fell short: at Size 0.05, Decay 15 and `lowDecay` 4 the band asked 60 s
   (factor 5.58) and got Decay's factor (1.38), and the 375 Hz band rang
   38.8 s (−35 %). Now `decayCorrection.ts` looks the factor up for the
   band's own target, Decay × `lowDecay`, at the block's Size, and the band
   rings 60.6 s (+1.0 %).
   - That target runs from 0.05 s to 240 s, so the table's RT60 axis now
     does too. The new columns (0.05, 0.1 and 0.15 s; 80, 120, 180 and
     240 s) were measured by `decayTable.mjs` the same way as the rest, in
     one run that reproduced all 208 earlier cells to the fourth decimal.
   - Under a quarter trip there is no T30 to fit, and those cells hold the
     shortest measured factor at their Size, as the short end of each row
     already did. A trip there loses at least 15 dB, so a factor a few
     percent off moves nothing audible.
   - Past the tank's ceiling no factor reaches the target. With every gain
     at 1 the tank still loses a little each pass, so at each Size it can
     only ring so long: 73.9 s at Size 0.05, 102 s at 0.075, 142 s at 0.1
     and 197 s at 0.15, measured. A cell past 95 % of its ceiling takes the
     factor that rings within 1 % of 95 % of it; past that, each doubling
     of the factor buys under 2 %. The largest factor is 16.7, and every
     gain point stays under 1.
   - The golden rows `low-band` and `low-band-moves` moved, because their
     band now takes its own factor. They were re-pinned. Every other row,
     every one at `lowDecay` 1, kept its hash.
9. **The shelf is written out in the tank's sample loop** (fix round 2,
   from Codex's review). Fix round 1 called `shelf` at each of the eight
   gain points while the band ran: 1,024 calls a quantum, against worklet
   rule 6 (a helper runs once a block, never per sample). The shelf's
   arithmetic is now written out at each point, with the same operations in
   the same order: patched back to the broadband factor, the new bundle
   renders bit for bit what fix round 1's did. `mixer/reverbLowBand.test.ts`
   reads the sample loop's calls off the shipped bundle. At `lowDecay` 2 the
   plate costs 36.8 µs a quantum in Node, down from 43.2 µs (37.3 from
   43.2 µs in Chrome); at `lowDecay` 1 it is unchanged, 34.7 against
   34.8 µs (research note, "CPU").

## Consequences

- Every song saved before version 11 is refused. A song that wants its
  plate back re-enters it on the new scale.
- The plate's sound changes wherever the tank runs, and tacowars listens on
  the PR preview before it merges.
- At the 60 s top every gain point stays under 1, and the longest corner
  (Decay 60 s × `lowDecay` 4, tank diffusions 0.8, at Size 4 and at Size
  0.05) decays to the sleep floor within 3 × 240 s. HOLD and a Decay step from 0.2 to 60 s and
  back pass the no-step test.
- A low band asked to ring past the tank's ceiling rings as long as the
  tank can at that Size. At Size 0.05, Decay 60 × `lowDecay` 4 asks 240 s
  and the 375 Hz band rings 74.6 s.
