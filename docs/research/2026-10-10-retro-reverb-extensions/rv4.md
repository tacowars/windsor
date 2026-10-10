# RV-4: Retro Reverb's Size range to 10, measured

Size now runs from 0.25 to 10, up from 3. The four tank lines are 31.1–53.9 ms
× Size, so at 10 they reach 539 ms. A Size keeps its meaning, so a saved
value plays as before. The tunables are `RETRO_REVERB_BOUNDS.size`,
`sizeSlew` and `earlyScaleMax` in
`packages/engine/src/inserts/retroReverbConstants.ts`.

All figures below: Apple M1, macOS (Darwin 25.6.0), arm64. Backend: Node
v24.21.0 / V8 13.6.233.17-node.53, offline, running the shipped
`retro-reverb-processor.js`. No browser was involved.

## Memory

The lines are allocated once, sized for the largest Size plus Drift's reach.
`rv4-bench.mjs` (beside this file) sums the bytes of the typed arrays one
instance holds:

| Bundle | Bytes per instance |
|---|---|
| main (`131dec4`), Size max 3 | 139,128 |
| this branch, Size max 10 | 248,064 |

That is 109 KB more per instance, all of it in the four tank lines
(`Float32Array`s of 7,303 to 12,645 samples at the 23,437.5 Hz internal
clock). The Size a song uses does not change it.

## CPU

`rv4-bench.mjs` is `rv2-bench.mjs` with a Size argument in place of the Drift
settings, the bytes count above, and user CPU time (`process.cpuUsage`) in
place of the wall clock. Other sessions kept the machine busy throughout
(load average 16–34 during the pass below), and the wall clock was useless:
the same case read anywhere from 18 to 71 µs. CPU time held steadier, but it
is still higher than RV-2's quiet-machine 9.3 µs. Compare the rows with each
other, not with RV-2.

The pass below is the quietest of three interleaved passes. Each value is
the median of three rounds, and each round is the median of six timed passes
of 1,500 quanta. The unit is CPU microseconds per 128-frame quantum per
instance at 48 kHz, in reverb mode, Mix 1, with a 0.25 sine input.

| Case | 1 instance | 8 | 16 |
|---|---|---|---|
| main, Size 1 | 14.00 | 13.74 | 13.79 |
| main, Size 3 | 13.98 | 13.79 | 13.44 |
| branch, Size 1 | 13.59 | 14.03 | 13.53 |
| branch, Size 3 | 13.76 | 13.29 | 13.05 |
| branch, Size 10 | 13.62 | 13.09 | 12.95 |

The cost doesn't depend on Size, and the branch costs the same as main.
Rounds of the same case differed by up to 1 µs, and the other two passes
agree within that. Longer lines do the same work a sample: one read and one
write per line. While Size holds still, the new Size ramp is one comparison
a tick.

## Size moves

On main, the block's smoothed Size was applied once per 128-frame block, so
a move made the line reads jump. `retroTank.ts` now ramps each line from one
block's Size to the next over the block's internal ticks. `retroReverbDsp.ts`
caps the smoothed move at `sizeSlew`, 55 Size a second. That is where
today's widest move (0.25 to 3) starts with the 50 ms smoothing, so no move
inside the old range reaches the cap.

Measured with a scratch script on a sustained three-note chord, Decay 2,
Mix 1, Character 0. "Read speed" is the longest line's read movement per
internal sample. Above 1 the read runs backwards, and below −1 faster than
real time. "Roughness" is the energy of the second difference over the
energy, in the 0.5 s after the move starts, divided by the same in a steady
0.5 s before it. A zipper shows up as roughness.

| Move | main: largest read jump | main: roughness | branch: read speed | branch: roughness |
|---|---|---|---|---|
| jump 0.25 → 3 | 180 samples in one tick | 17.7 | 2.74 | 0.46 |
| jump 3 → 0.25 | 180 samples in one tick | 12.7 | 2.74 | 8.3 |
| ramp 0.25 → 3 over 0.25 s | 37 samples in one tick | 23.6 | 0.59 | 0.16 |
| jump 0.25 → 10 | (not reachable) | | 2.96 | 1.31 |
| jump 10 → 0.25 | (not reachable) | | 2.96 | 10.7 |
| ramp 0.25 → 10 over 0.25 s | (not reachable) | | 2.09 | 0.32 |
| ramp 0.25 → 10 over 1 s | (not reachable) | | 0.53 | 0.14 |

The zipper is gone. Moves upward, and every knob-speed ramp, are now
smoother than the steady sound. That is the pitch falling as the lines grow.
A sudden jump down (Size 3 or 10 to 0.25) still reads rough. That roughness
is a pitch rise: the reads run up to about 4× real time for the first
50–100 ms. It is the same motion main made in steps. A jump from 0.25 to 10
moves no faster than a jump from 0.25 to 3 does today: 2.96 against 2.74,
where the gap is the cap's continuous rate against the block-sampled
smoothing.

Early's taps are still placed once a block. Under the cap they move at most
about 100 samples a block at any Size, which is what main allows within 0.25–3.

## Early above Size 4

RV-1 held Early's time scale to 0.5–4. With Size up to 10, the hold left a
gap at Size 10 between the last reflection (117 ms) and the tank's first
return (311 ms), with nothing in it. `earlyScaleMax` is now 10, so the
reflections keep landing ahead of the bloom at every Size, as RV-1 designed
them to. The cost is that at Size 7.5–10 the taps are 50–96 ms apart, so they
read as distinct echoes. The finite field's 0.6 s history holds the last tap
at Size 10, which is 293 ms. A/B renders of both choices are listed in the PR.

## Sleep and silence

Retro has no sleep. Its silence handling is per value: the one-pole states
snap to 0 below `silenceFloor`, and the switch's `clear` zeroes every line by
`fill`. Neither assumes a line length. Nothing else in the processor or the
insert refers to the longest line, so the 162 ms of the old maximum appears
nowhere.
