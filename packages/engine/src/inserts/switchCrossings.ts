/**
 * The crossings an insert's switch makes (windsor#629), from its changes:
 * pure functions for `switchTimeline.ts`, which owns the changes.
 *
 * - `crossings`: each change crosses the fade from where the last had got to,
 *   so a change mid-fade turns back at once. The stateless kinds' gains read
 *   these.
 * - `settledCrossings` (fix round 1 for PR #635): an effect that holds what
 *   it was fed (Echo's loop, the Plate's tank) reads these. An off always
 *   fades to its end, and the next on waits until the effect has emptied,
 *   `settle(offEnd)` seconds after that end; an off that comes before the
 *   waiting on has begun cancels it. So nothing from before an off is heard
 *   after it, however soon the switch comes back on.
 *
 * `switchTimeline.test.ts` pins both through the views that read them, and
 * `insertSwitchFadeNative.test.ts` the settled ones' sound.
 */

/** The switch's own value from `time`: a change of the step, by lane or knob. */
export interface SwitchStep {
  readonly time: number;
  readonly to: number;
}

/** One crossing, answering the change at `step`: from `from` at `start` to `to` at `end`. */
export interface Crossing {
  readonly step: number;
  readonly start: number;
  readonly end: number;
  readonly from: number;
  readonly to: number;
}

/** Where the crossings start from: the switch's settled value, and the end of its last off. */
export interface SwitchOrigin {
  readonly time: number;
  readonly value: number;
  /** The end of the last off's fade at or before `time`; -Infinity for none. */
  readonly offEnd: number;
}

/** How long an effect needs after its fade out ends at `offEnd` before it is empty. */
export type SwitchSettle = (offEnd: number) => number;

/** The fade's value at `time` on `crossing`, `fade` seconds long. */
export function along(crossing: Crossing, time: number, fade: number): number {
  if (time >= crossing.end) return crossing.to;
  const { from, to, start } = crossing;
  return from + ((to - from) * (time - start)) / fade;
}

/** Each change as a crossing from where the last had got to. */
export function crossings(steps: readonly SwitchStep[], initial: number, fade: number): Crossing[] {
  const all: Crossing[] = [];
  for (const { time, to } of steps) {
    const last = all[all.length - 1];
    const from = last ? along(last, time, fade) : initial;
    all.push({ step: time, start: time, end: time + fade, from, to });
  }
  return all;
}

/**
 * Each change as a crossing, an on waiting until the effect has settled
 * after the last off's end, and an off never turned back.
 */
export function settledCrossings(
  steps: readonly SwitchStep[],
  origin: SwitchOrigin,
  fade: number,
  settle: SwitchSettle,
): Crossing[] {
  const all: Crossing[] = [];
  let { offEnd } = origin;
  let on = origin.value > 0;
  /** An on still waiting for the effect to empty. */
  let waiting: Crossing | undefined;
  for (const { time, to } of steps) {
    if (to > 0 && !on) {
      const start = Number.isFinite(offEnd) ? Math.max(time, offEnd + settle(offEnd)) : time;
      waiting = { step: time, start, end: start + fade, from: 0, to };
      on = true;
      continue;
    }
    if (to === 0) {
      on = false;
      offEnd = time + fade;
    }
    if (waiting && time < waiting.start) {
      // Not yet begun: an off cancels it, another on value waits with it.
      waiting = to > 0 ? { ...waiting, to } : undefined;
      continue;
    }
    if (waiting) all.push(waiting);
    waiting = undefined;
    const last = all[all.length - 1];
    const from = last ? along(last, time, fade) : origin.value;
    all.push({ step: time, start: time, end: time + fade, from, to });
  }
  if (waiting) all.push(waiting);
  return all;
}

/** The last crossing started at `time` (or, not `inclusive`, before it). */
export function lastStarted(
  all: readonly Crossing[],
  time: number,
  inclusive: boolean,
): Crossing | undefined {
  let found: Crossing | undefined;
  for (const c of all) if (inclusive ? c.start <= time : c.start < time) found = c;
  return found;
}

/** Each crossing's start, and its end unless the next starts by then. */
export function pointsOf(all: readonly Crossing[]): number[] {
  return all.flatMap((c, i) => {
    const next = all[i + 1];
    return next && next.start <= c.end ? [c.start] : [c.start, c.end];
  });
}
