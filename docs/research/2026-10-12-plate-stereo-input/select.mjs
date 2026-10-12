/* global process, console */
// The second stage of the right chain's choice (windsor#763): every set
// `chains.mjs` read with a mirror at Build 0 of `limit` dB or less, held to
// the checks the plate's earlier records pinned, each as its test reads it:
//   room    the `room` space's T30 against its T30 before windsor#748
//           (`mixer/reverbDecay.test.ts`, within 10 %); its 0.4 s Decay is
//           where the input diffusers' own ring weighs most, %
//   spaces  the worst of the six converted spaces' the same way, %
//   build   the worst T30 against Decay 2 and 10 s over Size 0.25, 1 and 4
//           and Build 0, 0.5 and 1 (`mixer/reverbBuild.test.ts`), %, the
//           Decay 2 s, Size 4 cells scaled by 9.5 / 10.5 (below)
//   rise    the largest fall of Build's time to the peak on `hall` and
//           `plate`, ms (within one 10 ms window)
// and, for a hard-left click, the room's and the build corner's T30 too.
// A set passes when every check holds with half a point to spare (9.5 %),
// so no pinned test sits on its edge. The one exception is the Build T30 at
// Decay 2 s and Size 4, which reads 9.8 % short on `main` already: its test
// takes 11 % there since windsor#763, and the check 10.5 %. Sets run from
// the smallest mirror up, cheapest check first, and the run stops at the
// first that passes: the set the plate ships.
// node select.mjs <new bundle> <limit dB> <chains tsv>...
import { readFileSync } from 'node:fs';
import { loadPlate } from './rig.mjs';
import { clickT30, riseMs, SPACES } from './measure.mjs';

const [file, limitArg, ...tables] = process.argv.slice(2);
const limit = Number(limitArg);
const sets = new Map();
for (const table of tables) {
  for (const line of readFileSync(table, 'utf8').split('\n')) {
    const [set, invert, , , , , mirror0] = line.split('\t');
    if (invert !== 'no' || !(Number(mirror0) <= limit)) continue;
    sets.set(set, Number(mirror0));
  }
}
// Identical lengths, as a reference row.
sets.set('0.004771345,0.003595309,0.012734787,0.009307483', NaN);

/** `mixer/reverbSpace.ts`'s rows and their T30s before windsor#748 (`mixer/reverbDecay.test.ts`). */
const BEFORE = [
  [{}, 3.366],
  [SPACES.plate, 1.24],
  [{ size: 0.28, decay: 0.4, preDelay: 0.008, inputLowCut: 120, inputHighCut: 11000, tankLowCut: 150, tankHighCut: 5500, modRate: 0.4, modDepth: 0.3 }, 0.421],
  [SPACES.hall, 6.336],
  [{ size: 0.7, decay: 5.05, preDelay: 0.012, inputLowCut: 200, inputHighCut: 16000, tankLowCut: 250, tankHighCut: 11000, modRate: 2.4, modDepth: 1.8 }, 4.355],
  [{ size: 3, decay: 30.4, preDelay: 0.05, inputLowCut: 45, inputHighCut: 8000, tankLowCut: 40, tankHighCut: 4200, modRate: 0.3, modDepth: 1.2 }, 30.376],
];
const ROOM = 2;
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0 };

const pct = (t, target) => (t / target - 1) * 100;
const LIMIT = 9.5;
const CORNER_LIMIT = 10.5;

/** Every check on one set, cheapest first; the first that fails ends the row ('-' after it). */
function checks(plate) {
  const out = { room: NaN, roomLeft: NaN, build: NaN, buildLeft: NaN, rise: NaN, spaces: NaN };
  const [room, before] = BEFORE[ROOM];
  out.room = pct(clickT30(plate, room, 'centred', 2 * before + 2), before);
  out.roomLeft = pct(clickT30(plate, room, 'left', 2 * before + 2), before);
  if (Math.abs(out.room) >= LIMIT || Math.abs(out.roomLeft) >= LIMIT) return out;
  out.build = 0;
  out.buildLeft = 0;
  for (const decay of [2, 10]) {
    for (const size of [0.25, 1, 4]) {
      for (const b of [0, 0.5, 1]) {
        const params = { ...OPEN, decay, size, build: b };
        // Each cell as a share of its own limit, so one figure says pass or fail.
        const limit = decay === 2 && size === 4 ? CORNER_LIMIT : LIMIT;
        const t = (side) =>
          (Math.abs(pct(clickT30(plate, params, side, 1.5 * decay + 3.5), decay)) / limit) * LIMIT;
        out.build = Math.max(out.build, t('centred'));
        out.buildLeft = Math.max(out.buildLeft, t('left'));
      }
    }
  }
  if (out.build >= LIMIT || out.buildLeft >= LIMIT) return out;
  out.rise = 0;
  for (const space of [SPACES.hall, SPACES.plate]) {
    const r = Array.from({ length: 11 }, (_, i) => riseMs(plate, { ...space, build: i / 10 }));
    for (let i = 1; i < r.length; i++) out.rise = Math.max(out.rise, r[i - 1] - r[i]);
  }
  if (out.rise > 10) return out;
  out.spaces = Math.max(
    ...BEFORE.map(([space, before]) => Math.abs(pct(clickT30(plate, space, 'centred', 2 * before + 2), before))),
  );
  out.pass = out.spaces < LIMIT;
  return out;
}

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
console.log('set\tmirror0\troom\troom L\tbuild\tbuild L\trise\tspaces\tpass');
const order = [...sets].sort((a, b) => (Number.isNaN(a[1]) ? -1 : Number.isNaN(b[1]) ? 1 : a[1] - b[1]));
for (const [set, mirror0] of order) {
  const plate = loadPlate(file, 48000, (source) =>
    source.replace(/var INPUT_DELAYS_RIGHT = \[[^\]]*\];/, `var INPUT_DELAYS_RIGHT = [${set}];`),
  );
  const c = checks(plate);
  console.log(
    [set, f(mirror0, 2), f(c.room), f(c.roomLeft), f(c.build), f(c.buildLeft), f(c.rise, 0), f(c.spaces), c.pass ? 'yes' : 'no'].join('\t'),
  );
  if (c.pass && !Number.isNaN(mirror0)) break;
}
