/**
 * An insert's on/off switch over time, as the params it moves read it
 * (windsor#629, record `2026-10-06-insert-switch-lanes` decision 8): every
 * change of the switch, by its lane or by the button, crosses
 * `INSERT_SWITCH_FADE_S` instead of stepping.
 *
 * The switch itself is a step: its lane's value (a `FieldTimeline`), or the
 * knob's where no lane holds it. The knob has a history here, unlike a
 * continuous field's, because the button's switch fades from the moment it is
 * pressed: `noteKnob(now)` records each change the shared schedule sees.
 *
 * The params read the step through one of two views:
 *
 * - `fade`: at each change at `t`, held at its value at `t`, then linear to
 *   the new value at `t + fade`. A change during a fade starts from where the
 *   fade had got to, so the view is continuous. Wet and dry gains read it.
 * - `open`: 1 from the moment the switch goes on, and until the fade out has
 *   finished after it goes off; 0 otherwise. What feeds an effect reads it,
 *   so the feed opens before the output fades in and closes once it is out.
 *
 * Either view may be settled (fix round 1 for PR #635): given how long its
 * effect takes to empty after an off, it reads `settledCrossings`, so an on
 * waits until the effect is empty (`switchCrossings.ts`).
 *
 * Main thread only: it allocates freely.
 */
import type { AutomationHow } from '../automation/automationHandles';
import { FieldTimeline, pruneBefore } from './fieldTimeline';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import type { Crossing, SwitchOrigin, SwitchSettle, SwitchStep } from './switchCrossings';
import { along, crossings, lastStarted, pointsOf, settledCrossings } from './switchCrossings';

/** What a shared param's schedule reads of one field over time (`sharedParamSchedule.ts`). */
export type FieldReader = Pick<
  FieldTimeline,
  'times' | 'lastBefore' | 'jumpsAt' | 'at' | 'approaching'
>;

/** How a param reads the switch: its fade, or whether its effect is fed. */
export type SwitchView = 'fade' | 'open';

/** The knob's value from `time` on. */
interface Knob {
  readonly time: number;
  readonly value: number;
}

export class SwitchTimeline {
  /** The lane's events; NaN wherever the knob governs (before the first, after a release). */
  private readonly lane = new FieldTimeline(() => NaN);
  private readonly knobs: Knob[];
  /** Where the crossings start from: a settled value, at the last prune. */
  private origin: SwitchOrigin;
  /** Every settled view's settle, so a prune waits for their crossings too. */
  private readonly settles = new Set<SwitchSettle>();

  /** `resting` is the knob's value now; `fade` the crossing's length in seconds. */
  constructor(
    private readonly resting: () => number,
    private readonly fade = INSERT_SWITCH_FADE_S,
  ) {
    const value = resting();
    this.origin = { time: -Infinity, value, offEnd: -Infinity };
    this.knobs = [{ time: -Infinity, value }];
  }

  schedule(value: number, time: number, how: AutomationHow): void {
    this.lane.schedule(value, time, how);
  }

  cancelFrom(time: number): void {
    this.lane.cancelFrom(time);
  }

  hold(value: number, time: number): void {
    this.lane.hold(value, time);
  }

  release(time: number): void {
    this.lane.release(time);
  }

  /** The knob may have moved: if so, it holds its new value from `now`. */
  noteKnob(now: number): void {
    const value = this.resting();
    if (value !== this.knobs[this.knobs.length - 1]!.value) this.knobs.push({ time: now, value });
  }

  /**
   * Forget what is over, once no view has a crossing that answers a change
   * at or before `now` and has not ended before it (under way, waiting, or
   * ending at `now`, whose point a rewrite from `now` writes again): the
   * crossings start from the value there, and the lane and the knob keep
   * their last event at or before it.
   */
  prune(now: number): void {
    const steps = this.steps();
    const views = [null, ...this.settles].map((settle) => this.crossingsOf(steps, settle));
    if (views.some((all) => all.some((c) => c.step <= now && c.end >= now))) return;
    let { value, offEnd } = this.origin;
    for (const step of steps) {
      if (step.time > now) break;
      value = step.to;
      if (step.to === 0) offEnd = step.time + this.fade;
    }
    this.origin = { time: now, value, offEnd };
    this.lane.prune(now);
    pruneBefore(this.knobs, (k) => k.time, now);
  }

  /**
   * The switch as `view` reads it; with `settle`, how long the effect takes
   * to empty after an off's fade ends, each on waits for it.
   */
  view(view: SwitchView, settle?: SwitchSettle): FieldReader {
    if (settle) this.settles.add(settle);
    const all = (): Crossing[] => this.crossingsOf(this.steps(), settle ?? null);
    const times = (): number[] => pointsOf(all());
    const value = (time: number, inclusive: boolean): number => {
      const initial = this.origin.value;
      const crossing = lastStarted(all(), time, inclusive);
      if (view === 'fade') return crossing ? along(crossing, time, this.fade) : initial;
      if (!crossing) return Number(initial > 0);
      // Open while on, and through a fade out: closed at its end, open just before it.
      const fading = inclusive ? time < crossing.end : time <= crossing.end;
      return Number(crossing.to > 0 || (fading && crossing.from > 0));
    };
    return {
      times,
      lastBefore: (time) => times().reduce((last, t) => (t < time ? t : last), -Infinity),
      // Every point is a change of the switch, so a first one is a set: the hold.
      jumpsAt: (time) => times().includes(time),
      at: (time) => value(time, true),
      approaching: (time) => value(time, false),
    };
  }

  private crossingsOf(steps: readonly SwitchStep[], settle: SwitchSettle | null): Crossing[] {
    return settle
      ? settledCrossings(steps, this.origin, this.fade, settle)
      : crossings(steps, this.origin.value, this.fade);
  }

  /** The switch's own value at `time`: the lane's, or the knob's where none holds it. */
  private stepAt(time: number): number {
    const lane = this.lane.at(time);
    if (!Number.isNaN(lane)) return lane;
    let value = this.knobs[0]!.value;
    for (const k of this.knobs) if (k.time <= time) value = k.value;
    return value;
  }

  /** Every change of the step since the origin. */
  private steps(): SwitchStep[] {
    const { origin } = this;
    const knobTimes = this.knobs.map((k) => k.time).filter((t) => Number.isFinite(t));
    const times = [...new Set([...this.lane.times(), ...knobTimes])]
      .filter((t) => t >= origin.time)
      .sort((x, y) => x - y);
    const steps: SwitchStep[] = [];
    let target = origin.value;
    for (const time of times) {
      const to = this.stepAt(time);
      if (to === target) continue;
      steps.push({ time, to });
      target = to;
    }
    return steps;
  }
}
