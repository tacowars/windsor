/**
 * Where the Roll's notes pane sits (windsor#602): the tick at its left edge
 * and the pitch in its middle, kept across a repaint so a write, a zoom or
 * a resize leaves the view where it was; and the ticks the pane shows,
 * which bound the notes drawn (`rollRepeats.ts`). A roll opened fresh
 * centres its notes, at tick 0. Split from the device (`rollCard.ts`,
 * windsor#708 decision 10). A zoom aims the next restore at the tick and
 * the top it worked out (`aim`, windsor#902), so a zoom bar's held edge
 * stays where it was.
 */
import type { RollNote } from '@windsor/engine';
import { type RollPanes, syncPanes } from './rollPanes';
import { type TickWindow, rollWindow } from './rollRepeats';
import { nearestRow, rowIndexAt } from './rollRows';
import { type RollScene, centrePitch } from './rollScene';
import { ROLL_EMPTY_CENTRE_PITCH } from './rollTables';
import type { RollSpot } from './rollView';

/** One device's notes pane: its spot, kept and restored, and the ticks it shows. */
export class RollViewSpot {
  private spot: RollSpot | null = null;
  /** Where the next restore puts the pane: a tick at its left edge, and the px of rows above its top. */
  private aimed: { tick: number | null; top: number | null } | null = null;

  constructor(private readonly panes: RollPanes) {}

  /** The spot kept, or null before the pane was laid out. */
  get kept(): RollSpot | null {
    return this.spot;
  }

  /**
   * Start again from `spot` (Expand opened or closed): the next paint scrolls
   * there, or, with none, centres the notes.
   */
  startFrom(spot: RollSpot | null): void {
    this.spot = spot;
  }

  /**
   * Put the pane's left edge on `tick`, or its top `top` px down the rows,
   * at the next restore; null keeps that axis on the spot.
   */
  aim(tick: number | null, top: number | null): void {
    this.aimed = { tick: tick ?? this.aimed?.tick ?? null, top: top ?? this.aimed?.top ?? null };
  }

  /** Remember where the pane sits over `scene`. */
  keep(scene: RollScene | null): void {
    const { panes } = this;
    if (!scene || panes.body.clientHeight === 0) return;
    const { rows } = scene.rows;
    const mid = rows[rowIndexAt(rows, panes.body.scrollTop + panes.body.clientHeight / 2)];
    this.spot = { tick: panes.body.scrollLeft / scene.pxPerTick, pitch: mid?.pitch ?? 0 };
  }

  /** Scroll the pane back to the spot over a new `scene`, or onto `notes` the first time. */
  restore(scene: RollScene | null, notes: readonly RollNote[]): void {
    const { panes } = this;
    if (!scene || panes.body.clientHeight === 0) return;
    const pitch = this.spot?.pitch ?? centrePitch(notes, ROLL_EMPTY_CENTRE_PITCH);
    const row = nearestRow(scene.rows.rows, pitch);
    const tick = this.aimed?.tick ?? this.spot?.tick ?? 0;
    const centred = row ? row.top + row.h / 2 - panes.body.clientHeight / 2 : 0;
    panes.body.scrollTop = this.aimed?.top ?? centred;
    panes.body.scrollLeft = tick * scene.pxPerTick;
    this.aimed = null;
    syncPanes(panes);
    this.keep(scene);
  }

  /** The ticks the pane shows over `scene`, widened by `margin` screens either side. */
  ticks(scene: RollScene, margin?: number): TickWindow {
    const { body } = this.panes;
    const view = {
      scrollPx: body.scrollLeft,
      widthPx: body.clientWidth,
      pxPerTick: scene.pxPerTick,
      regionTicks: scene.regionTicks,
    };
    return rollWindow(view, margin);
  }
}
