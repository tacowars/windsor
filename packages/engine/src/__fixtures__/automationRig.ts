/**
 * The automation player's rig (windsor#344): a `TickTransport` driven by
 * hand, a settable `now`, and one fake param per strip target behind a
 * knob handle, so a test reads the events each lane wrote. Node-only, like
 * the rest of this directory.
 */
import type { AutomationResolver } from '../automation/automationPlayer';
import { AutomationPlayer } from '../automation/automationPlayer';
import type { KnobHandle } from '../automation/automationHandles';
import { knobHandle, sameValue } from '../automation/automationHandles';
import type { AutomationLane, AutomationPoint } from '../automation/automationLane';
import { catalogRow } from '../automation/automationTargets';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { FakeParam } from './fakeAudioNodes';

/** 120 BPM: a tick is 1/48 s. */
export const RIG_BPM = 120;
/** The first tick's time, as the scheduler's start delay puts it after now. */
export const RIG_START = 0.06;
/** What every knob rests on: a release restores it. */
export const RIG_RESTING = 0.7;
export const RIG_SLOT = 3;
export const RIG_SONG_TICKS = 4 * TICKS_PER_BAR;

export const point = (tick: number, value: number, bend = 0): AutomationPoint => ({
  tick,
  value,
  bend,
});

export const lane = (
  target: AutomationLane['target'],
  points: AutomationPoint[],
  on = true,
): AutomationLane => ({ target, on, points });

export interface AutomationRig {
  readonly transport: TickTransport;
  readonly player: AutomationPlayer;
  /** The fake param behind each strip target, made on first use. */
  param(target: string): FakeParam;
  handle(target: string): KnobHandle;
  /** The audio clock's now, as the player reads it. */
  now: number;
  /** Issue `ticks` ticks, each at `RIG_START` plus the transport's seconds; returns their times. */
  run(ticks: number): number[];
  /** Every logged call on `target`'s param, from index `from` on. */
  calls(target: string, from?: number): { call: string; value: number; time?: number }[];
}

export function automationRig(restTick = 0): AutomationRig {
  const transport = new TickTransport(RIG_BPM);
  transport.reset(restTick);
  const params = new Map<string, FakeParam>();
  const handles = new Map<string, KnobHandle>();
  const param = (target: string): FakeParam => {
    let found = params.get(target);
    if (!found) {
      found = new FakeParam(RIG_RESTING);
      params.set(target, found);
    }
    return found;
  };
  const handle = (target: string): KnobHandle => {
    let found = handles.get(target);
    if (!found) {
      const params = [param(target) as unknown as AudioParam];
      found = knobHandle({ params, write: sameValue, resting: () => RIG_RESTING });
      handles.set(target, found);
    }
    return found;
  };
  const resolve: AutomationResolver = (_slot, target) => {
    const row = catalogRow(target);
    return row && { handle: handle(target), row };
  };
  const rig: AutomationRig = {
    transport,
    now: 0,
    player: new AutomationPlayer({
      transport,
      now: () => rig.now,
      resolve,
      songTicks: RIG_SONG_TICKS,
      restTick,
    }),
    param,
    handle,
    run(ticks: number): number[] {
      const times: number[] = [];
      for (let i = 0; i < ticks; i++) {
        const time = RIG_START + transport.transportSeconds;
        times.push(time);
        transport.advance(time);
      }
      return times;
    },
    calls: (target, from = 0) => param(target).automation.slice(from),
  };
  return rig;
}
