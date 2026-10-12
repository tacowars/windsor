// Candidate output-tap tables (windsor#766), drawn under the issue's structure
// and the side-lead rule this note derives ("How the table was chosen").
//
// Each half of the tank is fed by one input: L's chain enters the right loop
// (lines 8, 9, 10, 11) and R's the left (lines 4, 5, 6, 7), windsor#763. In
// each half the side its input leads is the "owner", the other the "guest".
// A half's slots are drawn on all four of its lines at Size 1, sorted by when
// a click injected into the half first reaches them (its first all-pass
// passes the input straight on, so lines a and b hear it at once, lines c and
// d a long line later), and dealt: every slot the injection reaches inside
// LEAD_ZONE goes to the owner, so the guest output hears nothing of the other
// input in the window `main` holds silent, and the rest alternate guest,
// owner, guest... so the two sides interleave around the loop. Owners read
// their slots at full magnitude more often, guests at three-quarters, and
// every sign is drawn; `search.mjs` reads each table and keeps the best.
import { noise } from '../2026-10-12-plate-stereo-input/rig.mjs';

/** Tank line lengths at Size 1, seconds, lines 4..11 (`TANK_DELAYS`). */
export const TANK = {
  4: 0.022579886,
  5: 0.149625349,
  6: 0.060481839,
  7: 0.1249958,
  8: 0.030509727,
  9: 0.141695508,
  10: 0.089244313,
  11: 0.106280031,
};

/** Each half's lines in loop order, and the side whose input feeds it. */
export const HALVES = [
  { lines: [8, 9, 10, 11], owner: 0 },
  { lines: [4, 5, 6, 7], owner: 1 },
];

/**
 * Seconds at Size 1 inside which a guest may not read a half: `main` keeps
 * the other side silent for 50 ms at Size 1 (200 ms at Size 4), and the
 * zone is 50 ms plus 2 ms for the linear read's reach and the modulation.
 */
export const LEAD_ZONE = 0.052;

/** No tap shorter than this, so one at Size 0.05 and 44.1 kHz still reads two samples back. */
export const SHORTEST = 0.001;
/** No tap past this share of its line, so the clamp (`_applySize`) never binds at Size 1. */
export const LONGEST_SHARE = 0.95;
/** Least spacing between two taps on one line, seconds. */
export const SPACING = 0.003;
/** The latest an owner's first tap may land at Size 1: 50 ms at Size 4, less 2.5 ms. */
export const FIRST_BY = 0.0119;

/** When a click injected into the half first reaches a tap on `index` (0..3) of its lines. */
export function arrival(half, index, time) {
  return index < 2 ? time : TANK[half.lines[1]] + time;
}

function drawTimes(rnd, count, lo, hi) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const times = Array.from({ length: count }, () => lo + (hi - lo) * rnd()).sort(
      (a, b) => a - b,
    );
    if (times.every((t, i) => i === 0 || t - times[i - 1] >= SPACING)) return times;
  }
  throw new Error('drawTimes: no spacing found');
}

/**
 * One half's slots at Size 1, `perLine` on each of its lines, or `shared`'s
 * times line for line; null when the owner's first tap can't land inside
 * FIRST_BY at SPACING from the rest.
 */
function halfSlots(half, rnd, perLine, shared, mirror) {
  const slots = [];
  for (const [index, line] of half.lines.entries()) {
    const longest = mirror
      ? Math.min(TANK[HALVES[0].lines[index]], TANK[HALVES[1].lines[index]])
      : TANK[line];
    let times = shared ? shared[index] : drawTimes(rnd, perLine[index], SHORTEST, longest * LONGEST_SHARE);
    // The owner's first tap, on the half's first all-pass, lands inside
    // FIRST_BY, so at Size 4 and Build 1 each side still hears its own input
    // in the first 50 ms, as on `main`.
    if (index === 0 && !shared && times[0] > FIRST_BY) {
      times = [SHORTEST + (FIRST_BY - SHORTEST) * rnd(), ...times.slice(1)].sort((a, b) => a - b);
      if (times.some((t, i) => i > 0 && t - times[i - 1] < SPACING)) return null;
    }
    for (const time of times) slots.push({ line, index, time, at: arrival(half, index, time) });
  }
  return slots;
}

/**
 * One candidate: `perSide` taps a side, `perLine` slots on each of a half's
 * four lines (summing to `perSide`, since each half deals a side's own and
 * the other side's guest taps), how many of a half's slots its owner takes
 * (`ownCount`, half by default), whether both halves share their times
 * line for line (`mirror`), whether the deal past the lead zone starts
 * with the owner (`ownerDealsFirst`), and the chances that an owner's tap is full
 * and a guest's three-quarters. Returns the table as `patchTaps` takes it,
 * left taps first, each side's sorted by line then time.
 */
export function drawTable({
  seed,
  perSide,
  perLine,
  ownCount = perSide / 2,
  ownFull = 0.8,
  guestThree = 0.8,
  mirror = false,
  ownerDealsFirst = false,
}) {
  const raw = noise(seed);
  const rnd = () => raw() * 0.5 + 0.5;
  const sides = [[], []];
  let shared;
  for (const half of HALVES) {
    const slots = halfSlots(half, rnd, perLine, mirror ? shared : undefined, mirror);
    if (!slots) return null;
    if (mirror && !shared) {
      shared = half.lines.map((_, index) => slots.filter((s) => s.index === index).map((s) => s.time));
    }
    slots.sort((a, b) => a.at - b.at);
    const guest = 1 - half.owner;
    let ownerLeft = ownCount;
    let guestLeft = perSide - ownCount;
    // Owners take the lead zone, then the deal alternates from the guest.
    let next = ownerDealsFirst ? half.owner : guest;
    for (const slot of slots) {
      let side;
      if (slot.at < LEAD_ZONE || guestLeft <= 0) side = half.owner;
      else if (ownerLeft <= 0) side = guest;
      else side = next;
      if (side === half.owner) ownerLeft--;
      else guestLeft--;
      if (slot.at >= LEAD_ZONE) next = side === guest ? half.owner : guest;
      const full = side === half.owner ? rnd() < ownFull : rnd() >= guestThree;
      const sign = rnd() < 0.5 ? -1 : 1;
      sides[side].push({ line: slot.line, time: slot.time, gain: sign * (full ? 1 : 0.75) });
    }
    if (ownerLeft < 0 || guestLeft < 0) return null;
  }
  for (const side of sides) side.sort((a, b) => a.line - b.line || a.time - b.time);
  const all = [...sides[0], ...sides[1]];
  if (sides[0].length !== perSide || sides[1].length !== perSide) return null;
  return {
    perSide,
    time: all.map((t) => Number(t.time.toFixed(6))),
    line: all.map((t) => t.line),
    gain: all.map((t) => t.gain),
    trim: 0.6,
  };
}

/** Each side's |gain| on the half its own input feeds, and on the other. */
export function shares(table) {
  const out = [];
  for (const side of [0, 1]) {
    let own = 0;
    let other = 0;
    for (let t = side * table.perSide; t < (side + 1) * table.perSide; t++) {
      const fed = HALVES[side].lines.includes(table.line[t]);
      if (fed) own += Math.abs(table.gain[t]);
      else other += Math.abs(table.gain[t]);
    }
    out.push({ own, other });
  }
  return out;
}
