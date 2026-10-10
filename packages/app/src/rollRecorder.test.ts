/**
 * The Roll recorder (windsor#663) over the real context and its undo history
 * (the rig is `__fixtures__/rollRecorderRig.ts`). What the
 * tests pin is the issue's boundary cases: where a take writes, where a held
 * note is cut and when it is written, the ordering that sees a loop's jump
 * before the release after it, and one undo step per take, split by every
 * other edit, with the notes still held carried across it.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { PartRegion } from '@windsor/engine';
import { partAt } from '@windsor/engine';
import { BAR, SPT, VEL, armed, n, rig } from './__fixtures__/rollRecorderRig';
import { partChange } from './context';
import { withGesture } from './gestureHooks';
import { library, loadPageLibrary } from './libraryModel';
import { heldStart } from './rollRepeats';
import { bpmChange } from './transportModel';

beforeAll(() => loadPageLibrary(library));

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
    stop.stop();
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

  it('orders an event stamped before a loop’s jump ahead of the jump, though it arrives after it', () => {
    // The loop is bar 2. A press stamped at 190 arrives with the clock
    // already wrapped to 100: it is pressed at 190 and cut at the loop's
    // end, so the release at 110 of the next pass does not make it one tick.
    const loop = { start: BAR, end: 2 * BAR };
    // The clock's time at `to` in the next pass, having been at `from`.
    const wrapped = (from: number, to: number): number =>
      (from + (2 * BAR - from) + (to - BAR)) * SPT;
    const press = armed(rig(loop), 180);
    press.at(100, wrapped(180, 100));
    press.rec.press(press.part(), 'KeyA', 60, VEL, 190);
    press.at(110, wrapped(180, 110));
    press.rec.release(press.part(), 'KeyA', 60, 110);
    expect(press.notes(0)).toEqual([n(190, 2)]);

    // A release stamped at 190 arriving after the wrap ends its note at 190,
    // not at the loop's end.
    const release = armed(rig(loop), 150);
    release.press(150);
    release.at(100, wrapped(150, 100));
    release.rec.release(release.part(), 'KeyA', 60, 190);
    expect(release.notes(0)).toEqual([n(150, 40)]);
  });

  it('keeps a note held from a region into a gap pending and frozen at the region’s end, Rec still armed', () => {
    const r = armed(rig(), 4 * BAR - 4);
    r.press(4 * BAR - 4);
    r.at(4 * BAR + 16);
    r.rec.sync();
    expect(r.rec.look()).toBe('paused');
    expect(r.rec.held(0).map(({ tick, ticks }) => [tick, ticks])).toEqual([[4 * BAR - 4, 4]]);
    expect(r.notes(0)).toEqual([]);
    r.release(4 * BAR + 20);
    expect([r.rec.held(0), r.notes(0)]).toEqual([[], [n(4 * BAR - 4, 4)]]);
  });

  it('cuts a note held across the song’s own wrap at its region’s end, polled coarsely or released late', () => {
    // Loop off, or over the whole song: the engine hands the clock no loop,
    // and its counter runs on past the song's end (positions are the tick
    // modulo the song). A key down 2 ticks before the end of region 1 (bars
    // 6–8, the song's last tick), polled once before the wrap, and let go 3
    // ticks into the next pass: the note ends at the region's end, which is
    // also its loop's.
    const end = 8 * BAR;
    for (const loop of [undefined, { start: 0, end }]) {
      const polled = armed(rig(loop), end - 2);
      polled.press(end - 2);
      polled.at(end - 1);
      polled.rec.sync();
      polled.release(end + 3);
      expect(polled.notes(1)).toEqual([n(BAR - 2, 2)]);

      // The release arrives long after the wrap, timer throttled: the
      // playhead is well into the next pass when the stamped release lands.
      const late = armed(rig(loop), end - 2);
      late.press(end - 2);
      late.at(end + 200);
      late.release(end + 3);
      expect(late.notes(1)).toEqual([n(BAR - 2, 2)]);
    }
  });

  it('draws a note held in the second pass of a repeating region on that pass', () => {
    // Region 1 is bars 6–8 looping one bar: a key down 10 ticks into its
    // second pass is drawn there, under the playhead, not over the first.
    const r = armed(rig(), 6 * BAR);
    r.press(6 * BAR + 10);
    r.at(6 * BAR + 30);
    r.rec.sync();
    const [note] = r.rec.held(0);
    expect(note).toMatchObject({ regionIndex: 1, tick: 10, local: BAR + 10, ticks: 20 });
    expect(heldStart(note!, { loopTicks: BAR, regionTicks: 3 * BAR })).toBe(BAR + 10);
  });

  it('records through another control’s drag, and writes it as its own step when the drag ends', () => {
    const r = armed(rig());
    const velocity = partAt(r.ctx.model.doc, 0)?.velocity;
    r.ctx.beginGesture('Level');
    r.ctx.change(partChange(0, { velocity: 0.5 }));
    r.press(10);
    r.release(20);
    expect(r.notes(0)).toEqual([]);
    r.ctx.endGesture();
    expect(r.notes(0)).toEqual([n(10, 10)]);
    expect(r.ctx.undoLabel).toBe('Record');
    r.ctx.undo();
    expect([r.notes(0), partAt(r.ctx.model.doc, 0)?.velocity]).toEqual([[], 0.5]);
    expect(r.ctx.undoLabel).toBe('Level');
    r.ctx.undo();
    expect([partAt(r.ctx.model.doc, 0)?.velocity, r.ctx.canUndo]).toEqual([velocity, false]);
  });
});

describe('the take’s undo step', () => {
  it('closes the take before an undo, which takes back what it wrote; a key still held carries on', () => {
    const r = armed(rig());
    r.press(10);
    r.release(14);
    r.press(20, 64, 'KeyD');
    r.at(50);
    expect(r.ctx.undo()).toBe(true);
    expect(r.notes(0)).toEqual([]);
    r.release(60, 64, 'KeyD');
    expect(r.notes(0)).toEqual([n(20, 40, 64)]);
    expect(r.ctx.canRedo).toBe(false);
    r.ctx.undo();
    expect([r.notes(0), r.ctx.canUndo]).toEqual([[], false]);
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
    r.stop();
    const notes = [n(10, 10), n(30, 15, 64), n(50, 10, 67)];
    expect(r.notes(0)).toEqual(notes);
    const steps: string[] = [];
    while (r.ctx.canUndo) {
      steps.push(r.ctx.undoLabel ?? '');
      r.ctx.undo();
      steps.push(`${r.notes(0).length} notes, velocity ${partAt(r.ctx.model.doc, 0)?.velocity}`);
    }
    expect(steps).toEqual([
      'Record',
      '1 notes, velocity 0.5',
      'Quantise',
      `1 notes, velocity ${velocity}`,
      'Record',
      `0 notes, velocity ${velocity}`,
    ]);
  });

  it('carries a key held across a knob turn into the later take, its length from press to release', () => {
    const r = armed(rig());
    const velocity = partAt(r.ctx.model.doc, 0)?.velocity;
    r.press(10, 64, 'KeyD');
    r.release(20, 64, 'KeyD');
    r.press(30);
    r.at(40);
    r.ctx.change(partChange(0, { velocity: 0.5 }), 'Level');
    r.at(200);
    r.rec.sync();
    expect(r.notes(0)).toEqual([n(10, 10, 64)]);
    r.release(250);
    expect(r.notes(0)).toEqual([n(10, 10, 64), n(30, 220)]);
    r.ctx.undo();
    expect([r.notes(0), partAt(r.ctx.model.doc, 0)?.velocity]).toEqual([[n(10, 10, 64)], 0.5]);
    expect(r.ctx.undoLabel).toBe('Level');
    r.ctx.undo();
    expect([r.notes(0), partAt(r.ctx.model.doc, 0)?.velocity]).toEqual([[n(10, 10, 64)], velocity]);
    r.ctx.undo();
    expect([r.notes(0), r.ctx.canUndo]).toEqual([[], false]);
  });

  it('drops a key held across an edit that deletes its region: there is nowhere to write it', () => {
    const r = armed(rig());
    r.press(5 * BAR + 10);
    r.at(5 * BAR + 30);
    const regions = partAt(r.ctx.model.doc, 0)?.regions.slice(0, 1) as PartRegion[];
    r.ctx.change(partChange(0, { regions }));
    r.release(5 * BAR + 40);
    expect(partAt(r.ctx.model.doc, 0)?.regions).toHaveLength(1);
    r.ctx.undo();
    expect([r.notes(1), r.ctx.canUndo]).toEqual([[], false]);
  });
});
