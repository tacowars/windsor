/**
 * The Roll recorder (windsor#663) over the real context and its undo history,
 * with a fake engine and a fake clock: the tap stamps each note at the tick
 * it is handed, and the clock's time moves with the transport. What the
 * tests pin is the issue's boundary cases: where a take writes, where a held
 * note is cut and when it is written, the ordering that sees a loop's jump
 * before the release after it, and one undo step per take, split by every
 * other edit.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  ApplyResult,
  ArrangementDocument,
  AudioPart,
  PartRegion,
  RollNote,
} from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { withGesture } from './gestureHooks';
import type { EngineHost } from './host';
import { library, loadPageLibrary } from './libraryModel';
import { RollRecorder } from './rollRecorder';
import { newSong } from './songParts';
import { bpmChange } from './transportModel';

beforeAll(() => loadPageLibrary(library));

const BAR = TICKS_PER_BAR;
/** The seconds a tick lasts on the fake clock. */
const SPT = 0.01;
const VEL = 0.9;

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

interface Rig {
  ctx: AppContext<TabPanel>;
  rec: RollRecorder;
  clock: { running: boolean; tick: number; time: number };
  part(slot?: number): AudioPart;
  /** The playhead moves to `tick`, the clock's time with it (or to `time`). */
  at(tick: number, time?: number): void;
  press(tick: number, pitch?: number, source?: string): void;
  release(tick: number, pitch?: number, source?: string): void;
  notes(region: number): readonly RollNote[];
}

function rig(loop?: { start: number; end: number }): Rig {
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
  const rec = new RollRecorder({
    doc: () => ctx.model.doc,
    selected: () => ctx.parts.selected,
    livePart: () => ctx.livePart(),
    running: () => clock.running,
    position: () => clock.tick,
    now: () => ({ tick: clock.tick, time: clock.time }),
    stamp: (timeStamp) => timeStamp ?? clock.tick,
    secondsPerTick: () => SPT,
    settle: () => !ctx.gestureOpen,
    write: (partial) => ctx.recordTake(partial, 'Record')?.ok === true,
    closeStep: () => ctx.closeTake(),
  });
  ctx.onBeforeEdit(() => rec.close());
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
const n = (tick: number, ticks: number, pitch = 60): RollNote => ({
  tick,
  ticks,
  pitch,
  velocity: VEL,
});

/** Rec armed with the playhead at `tick`, running. */
function armed(r: Rig, tick = 0): Rig {
  r.at(tick);
  r.rec.setOn(true);
  expect(r.rec.on).toBe(true);
  return r;
}

describe('the Rec switch', () => {
  it('arms only over a region, and disarms anywhere, paused in a gap included', () => {
    const r = rig();
    r.at(4 * BAR + 10);
    r.rec.setOn(true);
    expect([r.rec.on, r.rec.look()]).toEqual([false, 'no-region']);
    r.at(10);
    r.rec.setOn(true);
    expect(r.rec.look()).toBe('recording');
    r.at(4 * BAR + 10);
    expect(r.rec.look()).toBe('paused');
    r.rec.setOn(false);
    expect([r.rec.on, r.rec.look()]).toEqual([false, 'no-region']);
  });
});

describe('a take', () => {
  it('writes what is played into the region under the playhead, both regions in one undo step', () => {
    const r = armed(rig());
    r.press(10);
    r.release(20);
    r.press(5 * BAR + 100, 64);
    r.release(5 * BAR + 110, 64);
    expect(r.notes(0)).toEqual([n(10, 10)]);
    expect(r.notes(1)).toEqual([n(4, 10, 64)]);
    expect(r.ctx.undoLabel).toBe('Record');
    expect(r.ctx.undo()).toBe(true);
    expect([r.notes(0), r.notes(1), r.ctx.canUndo]).toEqual([[], [], false]);
  });

  it('writes nothing for a key pressed in a gap and let go in the next region', () => {
    const r = armed(rig());
    r.press(4 * BAR + 50);
    r.release(5 * BAR + 10);
    expect([r.notes(0), r.notes(1), r.ctx.canUndo]).toEqual([[], [], false]);
  });

  it('cuts a held key at a transport stop, Rec off and a part switch, and writes it there', () => {
    const stop = armed(rig());
    stop.press(10);
    stop.at(40);
    stop.rec.sync();
    stop.clock.running = false;
    stop.rec.sync();
    expect(stop.notes(0)).toEqual([n(10, 30)]);

    const off = armed(rig());
    off.press(10);
    off.at(50);
    off.rec.setOn(false);
    off.release(60);
    expect(off.notes(0)).toEqual([n(10, 40)]);

    const sw = armed(rig());
    sw.press(10);
    sw.at(70);
    sw.ctx.parts.pick(1);
    sw.rec.sync();
    expect(sw.notes(0)).toEqual([n(10, 60)]);
  });

  it('ends every held note at Panic and runs on, all in one step', () => {
    const r = armed(rig());
    r.press(10, 60);
    r.press(12, 64, 'KeyD');
    r.at(30);
    r.rec.panic();
    expect(r.notes(0)).toEqual([n(10, 20), n(12, 18, 64)]);
    r.press(40, 67, 'KeyG');
    r.release(44, 67, 'KeyG');
    expect(r.notes(0)).toHaveLength(3);
    r.ctx.undo();
    expect(r.notes(0)).toEqual([]);
  });

  it('keeps two inputs on one pitch apart, each ended by its own release', () => {
    const r = armed(rig());
    r.press(10, 60, 'midi:a:60');
    r.press(12, 60, 'midi:b:60');
    r.press(14, 64, 'KeyD');
    r.release(20, 60, 'midi:a:60');
    r.release(22, 64, 'KeyD');
    r.release(30, 60, 'midi:b:60');
    // The normaliser trims the earlier of two overlapping notes at a pitch.
    expect(r.notes(0)).toEqual([n(10, 2), n(12, 18), n(14, 8, 64)]);
  });

  it('sees a loop’s jump before the release after it: the note is cut at the loop’s end', () => {
    // The loop is bar 2; the key goes down at 98, the jump at 192 lands on
    // 96, and the release comes at 100 of the next pass before any redraw.
    const r = armed(rig({ start: BAR, end: 2 * BAR }), 98);
    r.press(98);
    r.at(100, (2 * BAR - 98 + 100 - BAR) * SPT + 98 * SPT);
    r.release(100);
    expect(r.notes(0)).toEqual([n(98, 2 * BAR - 98)]);
  });

  it('records nothing while another control’s drag is open', () => {
    const r = armed(rig());
    r.ctx.beginGesture('Level');
    r.press(10);
    r.release(20);
    r.ctx.endGesture();
    expect(r.notes(0)).toEqual([]);
  });
});

describe('the take’s undo step', () => {
  it('ends the take before an undo, which then takes it all back', () => {
    const r = armed(rig());
    r.press(10);
    r.release(14);
    r.press(20, 64, 'KeyD');
    r.at(50);
    expect(r.ctx.undo()).toBe(true);
    expect(r.notes(0)).toEqual([]);
    r.release(60, 64, 'KeyD');
    expect(r.notes(0)).toEqual([]);
    expect(r.ctx.redo()).toBe(true);
    expect(r.notes(0)).toEqual([n(10, 4), n(20, 30, 64)]);
  });

  it('empties the redo stack at its first write', () => {
    const r = armed(rig());
    r.ctx.change(bpmChange(133));
    r.ctx.undo();
    expect(r.ctx.canRedo).toBe(true);
    r.press(10);
    r.release(20);
    expect(r.ctx.canRedo).toBe(false);
  });

  it('is split by another edit: undo takes back the later take, the edit and the earlier take', () => {
    const r = armed(rig());
    const velocity = partAt(r.ctx.model.doc, 0)?.velocity;
    r.press(10);
    r.release(20);
    r.press(30, 64, 'KeyD');
    r.at(40);
    withGesture('Quantise', () => r.ctx.change(partChange(0, { velocity: 0.5 })));
    r.release(45, 64, 'KeyD');
    r.press(50, 67, 'KeyG');
    r.release(60, 67, 'KeyG');
    r.clock.running = false;
    r.rec.sync();
    const notes = [n(10, 10), n(30, 10, 64), n(50, 10, 67)];
    expect(r.notes(0)).toEqual(notes);
    const steps: string[] = [];
    while (r.ctx.canUndo) {
      steps.push(r.ctx.undoLabel ?? '');
      r.ctx.undo();
      steps.push(`${r.notes(0).length} notes, velocity ${partAt(r.ctx.model.doc, 0)?.velocity}`);
    }
    expect(steps).toEqual([
      'Record',
      '2 notes, velocity 0.5',
      'Quantise',
      `2 notes, velocity ${velocity}`,
      'Record',
      `0 notes, velocity ${velocity}`,
    ]);
  });

  it('ends a note at an edit that deletes its region, which gets no write after', () => {
    const r = armed(rig());
    r.press(5 * BAR + 10);
    r.at(5 * BAR + 30);
    const regions = partAt(r.ctx.model.doc, 0)?.regions.slice(0, 1) as PartRegion[];
    r.ctx.change(partChange(0, { regions }));
    r.release(5 * BAR + 40);
    expect(partAt(r.ctx.model.doc, 0)?.regions).toHaveLength(1);
    r.ctx.undo();
    expect(r.notes(1)).toEqual([n(10, 20)]);
    r.ctx.undo();
    expect([r.notes(1), r.ctx.canUndo]).toEqual([[], false]);
  });
});
