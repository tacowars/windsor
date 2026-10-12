/**
 * The measured correction from the knob's Decay to the Decay the tank's gains
 * are cut from (windsor#748), by Size (rows) and Decay (columns). Charging the
 * loss on every segment (`tankGains.ts`) leaves the tank losing exactly 60 dB
 * over Decay but for what each pass round it costs on its own: the damping
 * one-poles (open at 10 Hz and 20 kHz, still not transparent), and the
 * fractional reads' interpolation, both of which take a fixed bite a pass, so
 * a small tank, passed many times a second, falls short the most. A factor
 * stretches the gains' Decay so the broadband T30 lands on the knob's.
 *
 * How it was measured: `docs/research/2026-10-12-plate-decay-seconds/decayTable.mjs`
 * on the bundle built with every factor 1, at 48 kHz in Node 24. An impulse
 * into the plate with `tankLowCut` 10 Hz, `tankHighCut` 20 kHz, `lowDecay` 1,
 * modulation off and the default diffusions; T30 from the Schroeder integral
 * of L² + R², a least-squares line through −5 to −35 dB. Each cell where one
 * trip round the tank (0.7254 s × Size) is under a quarter of Decay takes
 * three steps of f ← f × Decay / T30(Decay × f). A cell where the trip is
 * longer, whose tail is a few discrete echoes with no T30 to fit, holds the
 * factor of the shortest measured Decay at its Size. A factor under 1 is held
 * at 1: the tank's passes only ever shorten its tail, so one says the T30 is
 * the input diffusers' own ring (about 0.2 s, outside the loop), which no
 * factor steers. Each impulse comes after 0.5 s at its Size, since the plate
 * starts at Size 1 and glides. The tank diffusions moved the result by under
 * 2 %, so they are not an axis.
 *
 * The columns from 30 s to 60 s came with Decay's 60 s top (record
 * `2026-10-12-plate-decay-in-seconds`), measured in the same run as the rest,
 * which reproduced every earlier cell to the fourth decimal. Past three steps
 * a cell keeps stepping while its T30 is more than 1 % off, which only six of
 * the new cells, at Size 0.1 and under, needed. At Size 0.05 the factor climbs
 * steeply towards 60 s (5.58): the tank's own per-pass loss there is close to
 * the whole of a 60 s decay.
 *
 * `tankGains.ts` reads it bilinearly in Size and Decay, held at the edges.
 * The research note has the sweep that checks it.
 */
const DECAY_TABLE_SIZES = [0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1, 1.5, 2, 3, 4];
const DECAY_TABLE_DECAYS = [0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 7.5, 10, 15, 20, 30, 40, 60];
/* prettier-ignore */
const DECAY_TABLE_FACTORS = [
  1.0000, 1.0422, 1.0802, 1.0929, 1.1033, 1.1187, 1.1309, 1.1509, 1.1852, 1.2280, 1.2740, 1.3788, 1.5013, 1.8397, 2.3903, 5.5800, // Size 0.05
  1.0480, 1.0480, 1.0867, 1.0979, 1.1056, 1.1191, 1.1299, 1.1481, 1.1792, 1.2155, 1.2514, 1.3261, 1.4067, 1.5906, 1.8417, 2.6892, // Size 0.075
  1.0550, 1.0550, 1.0735, 1.0834, 1.0914, 1.1038, 1.1136, 1.1298, 1.1565, 1.1869, 1.2159, 1.2722, 1.3286, 1.4482, 1.5826, 1.9543, // Size 0.1
  1.0559, 1.0559, 1.0559, 1.0732, 1.0829, 1.0958, 1.1042, 1.1177, 1.1385, 1.1602, 1.1801, 1.2185, 1.2572, 1.3384, 1.4268, 1.6303, // Size 0.15
  1.0729, 1.0729, 1.0729, 1.0729, 1.0806, 1.0927, 1.1009, 1.1125, 1.1293, 1.1461, 1.1611, 1.1895, 1.2174, 1.2752, 1.3366, 1.4730, // Size 0.2
  1.0661, 1.0661, 1.0661, 1.0661, 1.0661, 1.0782, 1.0854, 1.0975, 1.1113, 1.1243, 1.1350, 1.1540, 1.1718, 1.2065, 1.2415, 1.3151, // Size 0.3
  1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0636, 1.0731, 1.0844, 1.0989, 1.1099, 1.1184, 1.1318, 1.1433, 1.1642, 1.1842, 1.2245, // Size 0.5
  1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0729, 1.0867, 1.0990, 1.1074, 1.1199, 1.1295, 1.1459, 1.1606, 1.1890, // Size 0.7
  1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0663, 1.0823, 1.0929, 1.1017, 1.1133, 1.1224, 1.1367, 1.1487, 1.1705, // Size 1
  1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0704, 1.0835, 1.0904, 1.1021, 1.1103, 1.1229, 1.1329, 1.1499, // Size 1.5
  1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0738, 1.0821, 1.0925, 1.1012, 1.1129, 1.1221, 1.1368, // Size 2
  1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0717, 1.0846, 1.0914, 1.1031, 1.1111, 1.1235, // Size 3
  1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0742, 1.0824, 1.0928, 1.1014, 1.1130, // Size 4
];

export { DECAY_TABLE_SIZES, DECAY_TABLE_DECAYS, DECAY_TABLE_FACTORS };
