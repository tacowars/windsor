/**
 * The measured correction from an RT60 asked of the tank to the RT60 its gains
 * are cut from (windsor#748), by Size (rows) and RT60 (columns). Charging the
 * loss on every segment (`tankGains.ts`) leaves the tank losing exactly 60 dB
 * over Decay but for what each pass round it costs on its own: the damping
 * one-poles (open at 10 Hz and 20 kHz, still not transparent), and the
 * fractional reads' interpolation, both of which take a fixed bite a pass, so
 * a small tank, passed many times a second, falls short the most. A factor
 * stretches the gains' RT60 so the broadband T30 lands on the one asked.
 * `decayCorrection.ts` reads it for the broadband Decay and, separately, for
 * the low band's own target, Decay × `lowDecay`, which is why the columns run
 * from 0.05 s (0.2 × 0.25) to 240 s (60 × 4).
 *
 * How it was measured: `docs/research/2026-10-12-plate-decay-seconds/decayTable.mjs`
 * on the bundle built with every factor 1, at 48 kHz in Node 24. An impulse
 * into the plate with `tankLowCut` 10 Hz, `tankHighCut` 20 kHz, `lowDecay` 1,
 * modulation off and the default diffusions; T30 from the Schroeder integral
 * of L² + R², a least-squares line through −5 to −35 dB. Each cell where one
 * trip round the tank (0.7254 s × Size) is under a quarter of its RT60 takes
 * three steps of f ← f × RT60 / T30(RT60 × f), and more (up to twelve, or
 * forty past 60 s) while it is more than 1 % off. A factor under 1 is held at
 * 1: the tank's passes only ever shorten its tail, so one says the T30 is the
 * input diffusers' own ring (about 0.2 s, outside the loop), which no factor
 * steers. Each impulse comes after 0.5 s at its Size, since the plate starts
 * at Size 1 and glides. The tank diffusions moved the result by under 2 %, so
 * they are not an axis.
 *
 * Two kinds of cell can't be measured, and are filled:
 * - **Short of a quarter trip** (every cell under 0.15 s, and the short end
 *   of every row past Size 0.05), whose tail is a few discrete echoes with no
 *   T30 to fit: the cell holds the factor of the shortest measured RT60 at its
 *   Size. That bounds the error: a trip there loses at least 15 dB, and
 *   60 × trip / RT60 dB in all, so a factor a few percent off moves each echo
 *   by a few percent of a loss that already buries it, and the T30 such a
 *   tail reads is the input diffusers' ring whatever the factor.
 * - **Past the ceiling.** With every gain at 1 the tank still loses a little
 *   on each pass, so at each Size there is a longest T30 it can ring at all,
 *   measured the same way with the gains cut from 10^6 s: 73.9 s at Size
 *   0.05, 102.4 s at 0.075, 141.6 s at 0.1 and 196.9 s at 0.15 (past 252 s
 *   from 0.2 up). A cell past 95 % of its ceiling steps towards 95 % of the
 *   ceiling instead, the factor that rings within 1 % of it: past there each
 *   doubling of the factor buys under 2 %. These are the cells at Size 0.05
 *   from 80 s, 0.075 from 120 s, 0.1 from 180 s and 0.15 at 240 s; their
 *   T30 is 69.5 s, 96.4 s, 133.2 s and 185.2 s, and the factor falls across
 *   them so that RT60 × f, the gains' RT60, holds (about 1330 s at Size 0.05).
 *
 * The columns from 30 s to 60 s came with Decay's 60 s top, and the columns
 * under 0.2 s and past 60 s in fix round 2 (record
 * `2026-10-12-plate-decay-in-seconds`), each measured in one run that
 * reproduced every earlier cell to the fourth decimal. Size 0.05 at 60 s
 * (5.58) is one of those, stopped by its twelve steps 1.4 % short.
 *
 * `decayCorrection.ts` reads it bilinearly in Size and RT60, held at the
 * edges. The research note has the sweep that checks it.
 */
const DECAY_TABLE_SIZES = [0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4];
const DECAY_TABLE_DECAYS = [
  0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 60, 80, 120, 180,
  240,
];
/* prettier-ignore */
const DECAY_TABLE_FACTORS = [
  1.0000, 1.0000, 1.0000, 1.0000, 1.0422, 1.0802, 1.0929, 1.1033, 1.1187, 1.1309, 1.1509, 1.1852, 1.2280, 1.2740, 1.3788, 1.5013, 1.8397, 2.3903, 5.5800, 16.7052, 11.0863, 7.3783, 5.5258, // Size 0.05
  1.0480, 1.0480, 1.0480, 1.0480, 1.0480, 1.0867, 1.0979, 1.1056, 1.1191, 1.1299, 1.1481, 1.1792, 1.2155, 1.2514, 1.3261, 1.4067, 1.5906, 1.8417, 2.6892, 4.9309, 15.2051, 10.1941, 7.6145, // Size 0.075
  1.0550, 1.0550, 1.0550, 1.0550, 1.0550, 1.0735, 1.0834, 1.0914, 1.1038, 1.1136, 1.1298, 1.1565, 1.1869, 1.2159, 1.2722, 1.3286, 1.4482, 1.5826, 1.9543, 2.5773, 7.0464, 14.3161, 10.7808, // Size 0.1
  1.0559, 1.0559, 1.0559, 1.0559, 1.0559, 1.0559, 1.0732, 1.0829, 1.0958, 1.1042, 1.1177, 1.1385, 1.1602, 1.1801, 1.2185, 1.2572, 1.3384, 1.4268, 1.6303, 1.9145, 2.9097, 12.2747, 15.1971, // Size 0.15
  1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0806, 1.0927, 1.1009, 1.1125, 1.1293, 1.1461, 1.1611, 1.1895, 1.2174, 1.2752, 1.3366, 1.4730, 1.6301, 2.1100, 3.6728, 14.3072, // Size 0.2
  1.0661, 1.0661, 1.0661, 1.0661, 1.0661, 1.0661, 1.0661, 1.0661, 1.0782, 1.0854, 1.0975, 1.1113, 1.1243, 1.1350, 1.1540, 1.1718, 1.2065, 1.2415, 1.3151, 1.3950, 1.5779, 1.9883, 2.6210, // Size 0.3
  1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0731, 1.0844, 1.0989, 1.1099, 1.1184, 1.1318, 1.1433, 1.1642, 1.1842, 1.2245, 1.2661, 1.3560, 1.5112, 1.7150, // Size 0.5
  1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0867, 1.0990, 1.1074, 1.1199, 1.1295, 1.1459, 1.1606, 1.1890, 1.2173, 1.2761, 1.3724, 1.4805, // Size 0.7
  1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0823, 1.0929, 1.1017, 1.1133, 1.1224, 1.1367, 1.1487, 1.1705, 1.1911, 1.2324, 1.2973, 1.3671, // Size 1
  1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0835, 1.0904, 1.1021, 1.1103, 1.1229, 1.1329, 1.1499, 1.1650, 1.1931, 1.2344, 1.2767, // Size 1.5
  1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0821, 1.0925, 1.1012, 1.1129, 1.1221, 1.1368, 1.1494, 1.1720, 1.2038, 1.2354, // Size 2
  1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0846, 1.0914, 1.1031, 1.1111, 1.1235, 1.1334, 1.1502, 1.1726, 1.1940, // Size 3
  1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0824, 1.0928, 1.1014, 1.1130, 1.1221, 1.1365, 1.1545, 1.1710, // Size 4
];

export { DECAY_TABLE_SIZES, DECAY_TABLE_DECAYS, DECAY_TABLE_FACTORS };
