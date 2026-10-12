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
 *   measured the same way with the gains cut from 10^6 s: 92.8 s at Size
 *   0.05, 120.3 s at 0.075, 168.7 s at 0.1 and 241.7 s at 0.15 (past 252 s
 *   from 0.2 up). A cell past 95 % of its ceiling steps towards 95 % of the
 *   ceiling instead, the factor that rings within 1 % of it: past there each
 *   doubling of the factor buys under 2 %. These are the cells at Size 0.05
 *   from 120 s, 0.075 from 120 s, 0.1 from 180 s and 0.15 at 240 s; their
 *   T30 is 87.3 s, 113.2 s, 158.7 s and 227.5 s, and the factor falls across
 *   them so that RT60 × f, the gains' RT60, holds (about 1700 s at Size 0.05).
 *
 * The columns from 30 s to 60 s came with Decay's 60 s top, and the columns
 * under 0.2 s and past 60 s in fix round 2 (record
 * `2026-10-12-plate-decay-in-seconds`). The whole table was measured again,
 * the same way, for windsor#764 (record `2026-10-12-plate-modulation`): the
 * tank's second all-pass in each loop (lines 6 and 10) became a cubic read,
 * which loses less on each pass than the linear read it replaced, so a small
 * tank's long tail had run up to 17 % long. The factors moved by up to 3 %
 * from Size 1 up and up to 7 % from 0.3 to 0.7, and the ceilings rose;
 * the largest factor is 19.2 (Size 0.075 at 120 s), and every gain point
 * stays under 1.
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
  1.0000, 1.0000, 1.0000, 1.0000, 1.0338, 1.0740, 1.0881, 1.0979, 1.1142, 1.1276, 1.1505, 1.1891, 1.2332, 1.2762, 1.3647, 1.4601, 1.6798, 2.0152, 3.2023, 7.8642, 14.1854, 9.5153, 7.1112, // Size 0.05
  1.0266, 1.0266, 1.0266, 1.0266, 1.0266, 1.0738, 1.0885, 1.0978, 1.1113, 1.1224, 1.1407, 1.1709, 1.2052, 1.2387, 1.3072, 1.3795, 1.5389, 1.7428, 2.3124, 3.4532, 19.2488, 12.7641, 9.6179, // Size 0.075
  1.0000, 1.0000, 1.0000, 1.0000, 1.0000, 1.0572, 1.0747, 1.0846, 1.0984, 1.1093, 1.1256, 1.1485, 1.1714, 1.1929, 1.2360, 1.2812, 1.3790, 1.4881, 1.7709, 2.1715, 3.9571, 17.7413, 13.2186, // Size 0.1
  1.0501, 1.0501, 1.0501, 1.0501, 1.0501, 1.0501, 1.0642, 1.0724, 1.0839, 1.0921, 1.1039, 1.1219, 1.1403, 1.1570, 1.1880, 1.2182, 1.2800, 1.3463, 1.4959, 1.6891, 2.2332, 4.3839, 18.6424, // Size 0.15
  1.0677, 1.0677, 1.0677, 1.0677, 1.0677, 1.0677, 1.0677, 1.0761, 1.0883, 1.0962, 1.1084, 1.1236, 1.1372, 1.1489, 1.1706, 1.1923, 1.2376, 1.2863, 1.3944, 1.5172, 1.8434, 2.7008, 4.8608, // Size 0.2
  1.0639, 1.0639, 1.0639, 1.0639, 1.0639, 1.0639, 1.0639, 1.0639, 1.0763, 1.0832, 1.0954, 1.1100, 1.1222, 1.1319, 1.1490, 1.1651, 1.1976, 1.2314, 1.3030, 1.3803, 1.5548, 1.9157, 2.4945, // Size 0.3
  1.0527, 1.0527, 1.0527, 1.0527, 1.0527, 1.0527, 1.0527, 1.0527, 1.0527, 1.0613, 1.0712, 1.0860, 1.0974, 1.1063, 1.1201, 1.1315, 1.1515, 1.1699, 1.2058, 1.2420, 1.3182, 1.4459, 1.5931, // Size 0.5
  1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0595, 1.0732, 1.0851, 1.0936, 1.1066, 1.1167, 1.1332, 1.1474, 1.1733, 1.1983, 1.2490, 1.3297, 1.4182, // Size 0.7
  1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0591, 1.0743, 1.0851, 1.0937, 1.1055, 1.1146, 1.1288, 1.1406, 1.1615, 1.1809, 1.2186, 1.2766, 1.3383, // Size 1
  1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0563, 1.0691, 1.0761, 1.0879, 1.0961, 1.1083, 1.1177, 1.1332, 1.1465, 1.1710, 1.2065, 1.2425, // Size 1.5
  1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0603, 1.0685, 1.0790, 1.0878, 1.0998, 1.1088, 1.1228, 1.1343, 1.1540, 1.1810, 1.2075, // Size 2
  1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0613, 1.0738, 1.0809, 1.0928, 1.1010, 1.1133, 1.1228, 1.1383, 1.1582, 1.1767, // Size 3
  1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0622, 1.0707, 1.0814, 1.0901, 1.1020, 1.1110, 1.1249, 1.1416, 1.1563, // Size 4
];

export { DECAY_TABLE_SIZES, DECAY_TABLE_DECAYS, DECAY_TABLE_FACTORS };
