/**
 * The automation player's rig (windsor#344): a `TickTransport` driven by
 * hand, a settable `now`, and one fake param per owner and strip target
 * behind a knob handle, so a test reads the events each lane wrote. The
 * owner is the rig's part (`RIG_OWNER`) unless a test names another, a group
 * among them (windsor#614). Node-only, like the rest of this directory.
 */
import type { AutomationResolver } from '../automation/automationPlayer';
import { AutomationPlayer } from '../automation/automationPlayer';
import type { KnobHandle } from '../automation/automationHandles';
import { knobHandle, sameValue } from '../automation/automationHandles';
import type { AutomationLane, AutomationPoint } from '../automation/automationLane';
import type { AutomationOwner } from '../automation/automationOwner';
import { ownerKey, partOwner } from '../automation/automationOwner';
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
/** The rig's part, which owns a lane unless a test names another owner. */
export const RIG_OWNER: AutomationOwner = partOwner(RIG_SLOT);
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
  /** The fake param behind each owner's strip target, made on first use. */
  param(target: string, owner?: AutomationOwner): FakeParam;
  handle(target: string, owner?: AutomationOwner): KnobHandle;
  /** The audio clock's now, as the player reads it. */
  now: number;
  /** Issue `ticks` ticks, each at `RIG_START` plus the transport's seconds; returns their times. */
  run(ticks: number): number[];
  /** Every logged call on `target`'s param, from index `from` on; the rig's part's unless `owner` says. */
  calls(
    target: string,
    from?: number,
    owner?: AutomationOwner,
  ): { call: string; value: number; time?: number }[];
}

export function automationRig(restTick = 0): AutomationRig {
  const transport = new TickTransport(RIG_BPM);
  transport.reset(restTick);
  const params = new Map<string, FakeParam>();
  const handles = new Map<string, KnobHandle>();
  const keyOf = (target: string, owner: AutomationOwner): string => `${ownerKey(owner)} ${target}`;
  const param = (target: string, owner = RIG_OWNER): FakeParam => {
    const key = keyOf(target, owner);
    let found = params.get(key);
    if (!found) {
      found = new FakeParam(RIG_RESTING);
      params.set(key, found);
    }
    return found;
  };
  const handle = (target: string, owner = RIG_OWNER): KnobHandle => {
    const key = keyOf(target, owner);
    let found = handles.get(key);
    if (!found) {
      const params = [param(target, owner) as unknown as AudioParam];
      found = knobHandle({ params, write: sameValue, resting: () => RIG_RESTING });
      handles.set(key, found);
    }
    return found;
  };
  const resolve: AutomationResolver = (owner, target) => {
    const row = catalogRow(target);
    return row && { handle: handle(target, owner), row };
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
    calls: (target, from = 0, owner = RIG_OWNER) => param(target, owner).automation.slice(from),
  };
  return rig;
}
