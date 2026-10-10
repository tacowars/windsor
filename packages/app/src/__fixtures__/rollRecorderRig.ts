/**
 * The Roll recorder's rig (windsor#663): the recorder over the real context
 * and its undo history, with a fake engine and a fake clock. The tap stamps
 * each note at the tick it is handed, and the clock's time moves with the
 * transport. `rollRecorder.test.ts` drives it.
 */
import { expect } from 'vitest';

import type { ApplyResult, ArrangementDocument, AudioPart, RollNote } from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from '../appContext';
import { DocumentModel } from '../documentModel';
import type { EngineHost } from '../host';
import { RollRecorder } from '../rollRecorder';
import { newSong } from '../songParts';

export const BAR = TICKS_PER_BAR;
/** The seconds a tick lasts on the fake clock. */
export const SPT = 0.01;
export const VEL = 0.9;

/** An eight-bar song: region 0 over bars 1–4 looping all four, a one-bar gap, region 1 over bars 6–8 looping one. */
const REGIONS = [
  { start: 0, duration: 4 * BAR, pattern: { kind: 'roll', loopTicks: 4 * BAR, notes: [] } },
  { start: 5 * BAR, duration: 3 * BAR, pattern: { kind: 'roll', loopTicks: BAR, notes: [] } },
];

function rollSong(loop?: { start: number; end: number }): ArrangementDocument {
  const raw = newSong();
  const part = (slot: number): Record<string, unknown> => ({
    ...(raw.parts as Record<string, unknown>[])[0],
    slot,
    name: `Keys ${slot}`,
    sequencer: { kind: 'roll', loopTicks: BAR, notes: [] },
    regions: REGIONS,
  });
  const transport = { ...(raw.transport as object), bars: 8, loop: { ...loop, on: !!loop } };
  return new DocumentModel({ ...raw, transport, parts: [part(0), part(1)] }).doc;
}

export interface Rig {
  ctx: AppContext<TabPanel>;
  rec: RollRecorder;
  clock: Clock;
  part(slot?: number): AudioPart;
  /** The playhead moves to `tick`, the clock's time with it (or to `time`). */
  at(tick: number, time?: number): void;
  /** ‖ or ■: the transport's halt listeners, as `rollRecMount.ts` wires them, then the halt. */
  stop(): void;
  press(tick: number, pitch?: number, source?: string): void;
  release(tick: number, pitch?: number, source?: string): void;
  notes(region: number): readonly RollNote[];
}

/** The fake clock the rig's playhead reads. */
interface Clock {
  running: boolean;
  tick: number;
  time: number;
}

/** A recorder over `ctx` and `clock`, wired to its edits as `rollRecMount.ts` wires it. */
function recorderOver(ctx: AppContext<TabPanel>, clock: Clock): RollRecorder {
  const rec = new RollRecorder({
    doc: () => ctx.model.doc,
    selected: () => ctx.parts.selected,
    livePart: () => ctx.livePart(),
    running: () => clock.running,
    position: () => clock.tick,
    now: () => ({ tick: clock.tick, time: clock.time }),
    stamp: (timeStamp) => timeStamp ?? clock.tick,
    secondsPerTick: () => SPT,
    editOpen: () => ctx.gestureOpen,
    write: (partial) => ctx.recordTake(partial, 'Record')?.ok === true,
    closeStep: () => ctx.closeTake(),
  });
  ctx.onBeforeEdit((kind) => (kind === 'song' ? rec.close() : rec.split()));
  ctx.onGestureEnd(() => rec.gestureEnded());
  return rec;
}

export function rig(loop?: { start: number; end: number }): Rig {
  const model = new DocumentModel(rollSong(loop));
  const parts = new Map<number, AudioPart>();
  const part = (slot = 0): AudioPart => {
    if (!parts.has(slot)) parts.set(slot, { slot } as unknown as AudioPart);
    return parts.get(slot) as AudioPart;
  };
  const engine: ContextHost = {
    apply: (): ApplyResult => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: (slot) => part(slot),
  };
  const clock = { running: true, tick: 0, time: 0 };
  const ctx = new AppContext<TabPanel>({
    host: { ...engine, transport: { position: () => clock.tick } } as unknown as EngineHost,
    model,
    notify: () => {},
  });
  ctx.addTab('song', { hidden: false }, () => {});
  const rec = recorderOver(ctx, clock);
  const at = (tick: number, time = tick * SPT): void => {
    clock.tick = tick;
    clock.time = time;
  };
  return {
    ctx,
    rec,
    clock,
    part,
    at,
    stop: () => {
      rec.close();
      clock.running = false;
    },
    press: (tick, pitch = 60, source = 'KeyA') => {
      if (tick > clock.tick) at(tick);
      rec.press(part(ctx.parts.selected), source, pitch, VEL, tick);
    },
    release: (tick, pitch = 60, source = 'KeyA') => {
      if (tick > clock.tick) at(tick);
      rec.release(part(ctx.parts.selected), source, pitch, tick);
    },
    notes: (region) => {
      const pattern = partAt(ctx.model.doc, 0)?.regions[region]?.pattern;
      return pattern?.kind === 'roll' ? pattern.notes : [];
    },
  };
}

/** A recorded note at full key velocity. */
export const n = (tick: number, ticks: number, pitch = 60): RollNote => ({
  tick,
  ticks,
  pitch,
  velocity: VEL,
});

/** Rec armed with the playhead at `tick`, running. */
export function armed(r: Rig, tick = 0): Rig {
  r.at(tick);
  r.rec.setOn(true);
  expect(r.rec.on).toBe(true);
  return r;
}
