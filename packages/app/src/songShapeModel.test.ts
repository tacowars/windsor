/**
 * The Shape tool's rules (windsor#350 decisions 1–6): the range a press and
 * drag select, the draft's defaults and clamps, the stamp in the lane's units
 * and its replacement of the range alone, the readout, the popover's place,
 * and Apply as one undo step through the context.
 */
import { describe, expect, it } from 'vitest';
import {
  PPQ,
  TICKS_PER_BAR,
  catalogRow,
  ticksPerBar,
  toDisplay,
  valueAt,
  type ApplyResult,
  type AutomationPoint,
  type AutomationShapeSpec,
  type DocumentPartial,
} from '@windsor/engine';
import { AUTOMATION_DOCUMENT, AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { withGesture } from './gestureHooks';
import { withPoints } from './songAutomationEdit';
import { automationChange, lanesOf } from './songAutomationModel';
import {
  barAt,
  clampDraft,
  cycleCount,
  dutyLabel,
  phaseLabel,
  popoverPlacement,
  rateIndex,
  settingsOf,
  shapeControls,
  shapeDraft,
  shapeLabel,
  shapeRange,
  shapeReadout,
  shapedPoints,
  stampedPoints,
  type PopoverFrame,
  type ShapeRange,
} from './songShapeModel';
import {
  DEFAULT_SHAPE_SETTINGS,
  SHAPE_CHOICES,
  SHAPE_POPOVER,
  SHAPE_RATES,
  shapeRates,
} from './songShapeTables';

const BAR = TICKS_PER_BAR;
const SIXTEENTH = PPQ / 4;
const SONG = 16 * BAR;
const level = catalogRow('strip.level')!;
const pan = catalogRow('strip.pan')!;
const cutoff = catalogRow('voice.filter.cutoff')!;
const P = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });
const draft = (edit: Partial<AutomationShapeSpec> = {}): AutomationShapeSpec => ({
  ...DEFAULT_SHAPE_SETTINGS,
  top: 0.9,
  bottom: 0.1,
  ...edit,
});
const range = (startTick: number, endTick: number): ShapeRange => ({ startTick, endTick });
/** The ticks in a stamp where the value falls straight down: a square's falls. */
const falls = (points: readonly AutomationPoint[]): number[] =>
  points.flatMap((p, i) => {
    const next = points[i + 1];
    return next && next.tick === p.tick && next.value < p.value ? [p.tick] : [];
  });

describe('the range (decision 1)', () => {
  it('is the snapped span dragged, either way', () => {
    const drag = { pressTick: 2 * BAR + 5, fromTick: 2 * BAR + 6, toTick: 6 * BAR, dragged: true };
    expect(shapeRange(drag, SONG)).toEqual(range(2 * BAR + 6, 6 * BAR));
    expect(shapeRange({ ...drag, fromTick: 6 * BAR, toTick: 2 * BAR }, SONG)).toEqual(
      range(2 * BAR, 6 * BAR),
    );
  });

  it('is the bar under a press that did not drag', () => {
    const press = { pressTick: 3 * BAR + 40, fromTick: 3 * BAR + 42, toTick: 3 * BAR + 42 };
    expect(shapeRange({ ...press, dragged: false }, SONG)).toEqual(range(3 * BAR, 4 * BAR));
  });

  it('is one bar when a drag snaps back onto its own tick', () => {
    const drag = { pressTick: BAR + 1, fromTick: BAR, toTick: BAR, dragged: true };
    expect(shapeRange(drag, SONG)).toEqual(range(BAR, 2 * BAR));
  });

  it('keeps a press at the song end inside the song', () => {
    expect(barAt(SONG, SONG)).toEqual(range(SONG - BAR, SONG));
    expect(barAt(0, SONG)).toEqual(range(0, BAR));
    expect(barAt(10, BAR / 2)).toEqual(range(0, BAR / 2));
  });

  it("selects, counts and rates in a 3/4 song's 72-tick bars (windsor#430)", () => {
    const three = ticksPerBar('3/4');
    const press = { pressTick: three + 5, fromTick: three, toTick: three, dragged: false };
    expect(shapeRange(press, 8 * three, three)).toEqual(range(three, 2 * three));
    expect(shapeReadout(range(0, 2 * three), draft({ kind: 'ramp' }), 2, three)).toContain(
      ' · 2 bars · 1 cycle · 2 points',
    );
    expect(
      shapeRates(three)
        .map((r) => r.ticks)
        .slice(-3),
    ).toEqual([72, 144, 288]);
  });
});

describe('the draft (decisions 3 and 4)', () => {
  it('opens on the session settings, Top at the lane at the range start and Bottom at the minimum', () => {
    const points = [P(0, 0.5), P(4 * BAR, 2)];
    const opened = shapeDraft(level, points, range(2 * BAR, 3 * BAR), DEFAULT_SHAPE_SETTINGS);
    expect(opened.kind).toBe('square');
    expect(opened.rateTicks).toBe(SIXTEENTH);
    expect(opened.duty).toBe(0.5);
    expect(opened.phase).toBe(0);
    expect(opened.top).toBeCloseTo(toDisplay(level, valueAt(level, points, 2 * BAR)), 12);
    expect(opened.bottom).toBe(0);
  });

  it('starts on 1/16 among the Rate stops, 1/32 to 4 bars', () => {
    expect(SHAPE_RATES.map((r) => r.label)).toEqual([
      '1/32',
      '1/16',
      '1/8',
      '1/4',
      '1/2',
      '1 bar',
      '2 bars',
      '4 bars',
    ]);
    expect(SHAPE_RATES[rateIndex(DEFAULT_SHAPE_SETTINGS.rateTicks)]!.label).toBe('1/16');
    expect(SHAPE_RATES[7]!.ticks).toBe(4 * BAR);
  });

  it('keeps the session settings but not the lane-bound Top and Bottom', () => {
    const kept = settingsOf(draft({ kind: 'sine', rateTicks: BAR, phase: 0.25, duty: 0.3 }));
    expect(kept).toEqual({ kind: 'sine', rateTicks: BAR, phase: 0.25, duty: 0.3 });
    const next = shapeDraft(pan, [P(0, 0)], range(0, BAR), kept);
    expect(next).toMatchObject(kept);
  });

  it('clamps Phase to 1/16 steps, Duty to 10–90% and Rate to its stops', () => {
    const clamped = clampDraft(
      draft({ phase: 0.2, duty: 0.97, rateTicks: 7, top: 1.4, bottom: -1 }),
    );
    expect(clamped.phase).toBe(3 / 16);
    expect(clamped.duty).toBe(0.9);
    expect(clamped.rateTicks).toBe(SIXTEENTH);
    expect([clamped.top, clamped.bottom]).toEqual([1, 0]);
    expect(clampDraft(draft({ duty: 0 })).duty).toBe(0.1);
    expect(clampDraft(draft({ phase: 1.2 })).phase).toBe(1);
  });

  it('disables Rate and Phase for Ramp and S-curve, and Duty but for the square', () => {
    expect(shapeControls('square')).toEqual({ rate: true, phase: true, duty: true });
    expect(shapeControls('sine')).toEqual({ rate: true, phase: true, duty: false });
    expect(shapeControls('ramp')).toEqual({ rate: false, phase: false, duty: false });
    expect(shapeControls('sCurve')).toEqual({ rate: false, phase: false, duty: false });
  });

  it('labels the seven shapes, Phase in degrees and Duty in percent', () => {
    expect(SHAPE_CHOICES.map((c) => shapeLabel(c.kind))).toEqual([
      'Tri',
      'Square',
      'Saw ↑',
      'Saw ↓',
      'Sine',
      'Ramp',
      'S-curve',
    ]);
    expect(phaseLabel(0.25)).toBe('90°');
    expect(phaseLabel(1)).toBe('360°');
    expect(dutyLabel(0.35)).toBe('35%');
  });
});

describe('the stamp (decision 5 and the acceptance criteria)', () => {
  const over = range(BAR, 2 * BAR);

  it('rate sets the cycle count', () => {
    for (const rate of SHAPE_RATES.slice(0, 5)) {
      const stamp = stampedPoints(pan, over, draft({ rateTicks: rate.ticks }));
      expect(falls(stamp)).toHaveLength(BAR / rate.ticks);
      expect(cycleCount(over, draft({ rateTicks: rate.ticks }))).toBe(BAR / rate.ticks);
    }
  });

  it('duty moves the square’s fall', () => {
    const quarter = { rateTicks: PPQ };
    expect(falls(stampedPoints(pan, over, draft({ ...quarter, duty: 0.5 })))[0]).toBe(BAR + 12);
    expect(falls(stampedPoints(pan, over, draft({ ...quarter, duty: 0.25 })))[0]).toBe(BAR + 6);
  });

  it('phase shifts the shape', () => {
    const at = (phase: number): number =>
      valueAt(
        pan,
        stampedPoints(pan, over, draft({ kind: 'triangle', rateTicks: BAR, phase })),
        BAR,
      );
    expect(at(0)).not.toBeCloseTo(at(0.5), 6);
    expect(toDisplay(pan, at(0.5))).toBeCloseTo(0.9, 12);
    expect(toDisplay(pan, at(0))).toBeCloseTo(0.1, 12);
  });

  it('Ramp and S-curve ignore rate and phase', () => {
    for (const kind of ['ramp', 'sCurve'] as const) {
      const a = stampedPoints(pan, over, draft({ kind, rateTicks: SIXTEENTH, phase: 0 }));
      const b = stampedPoints(pan, over, draft({ kind, rateTicks: 4 * BAR, phase: 0.5 }));
      expect(a).toEqual(b);
      expect(cycleCount(over, draft({ kind }))).toBe(1);
    }
  });

  it('every shape starts and ends exactly on the range', () => {
    for (const choice of SHAPE_CHOICES) {
      const stamp = stampedPoints(cutoff, over, draft({ kind: choice.kind, phase: 0.3 }));
      expect(stamp[0]!.tick).toBe(over.startTick);
      expect(stamp[stamp.length - 1]!.tick).toBe(over.endTick);
    }
  });

  it('comes back in the lane’s units: a level square chops between Top and silence', () => {
    const chops = range(0, 8 * BAR);
    const opened = shapeDraft(level, [P(0, 1)], chops, DEFAULT_SHAPE_SETTINGS);
    const stamp = stampedPoints(level, chops, opened);
    expect(falls(stamp)).toHaveLength((8 * BAR) / SIXTEENTH);
    for (const p of stamp)
      expect([1, level.min].some((v) => Math.abs(p.value - v) < 1e-12)).toBe(true);
    expect(stamp.every((p) => p.bend === 0)).toBe(true);
  });

  it('replaces only the range: every point outside is kept as it was', () => {
    const points = [P(0, -1), P(BAR / 2, 0.3, 0.4), P(BAR + 12, 0.5), P(3 * BAR, 1), P(4 * BAR, 0)];
    const stamp = stampedPoints(pan, over, draft());
    const next = shapedPoints(points, over, stamp);
    expect(next.filter((p) => p.tick < over.startTick)).toEqual(points.slice(0, 2));
    expect(next.filter((p) => p.tick > over.endTick)).toEqual(points.slice(3));
    expect(next.filter((p) => p.tick >= over.startTick && p.tick <= over.endTick)).toEqual(stamp);
  });
});

describe('the readout (decision 3)', () => {
  it('names the range, its bars, its cycles and its points', () => {
    const over = range(2 * BAR, 10 * BAR);
    expect(shapeReadout(over, draft(), 513)).toBe(
      '3.1.1 → 11.1.1 · 8 bars · 128 cycles · 513 points',
    );
    expect(shapeReadout(range(0, BAR), draft({ kind: 'ramp' }), 2)).toBe(
      '1.1.1 → 2.1.1 · 1 bar · 1 cycle · 2 points',
    );
    expect(shapeReadout(range(0, BAR + SIXTEENTH), draft({ rateTicks: BAR }), 9)).toBe(
      '1.1.1 → 2.1.2 · 1.06 bars · 1.06 cycles · 9 points',
    );
  });
});

describe('the popover’s place (decision 2)', () => {
  const frame: PopoverFrame = {
    anchorX: 400,
    laneTop: 200,
    laneBottom: 256,
    viewLeft: 0,
    viewRight: 1200,
    viewportHeight: 900,
    width: 360,
    height: 260,
  };
  const { gapPx, marginPx } = SHAPE_POPOVER;

  it('opens below the lane at the range start', () => {
    expect(popoverPlacement(frame)).toEqual({ left: 400, top: 256 + gapPx, maxHeight: null });
  });

  it('stays inside the view at either edge', () => {
    expect(popoverPlacement({ ...frame, anchorX: -300 }).left).toBe(marginPx);
    expect(popoverPlacement({ ...frame, anchorX: 1100 }).left).toBe(1200 - 360 - marginPx);
    expect(popoverPlacement({ ...frame, viewLeft: 250, anchorX: 100 }).left).toBe(250 + marginPx);
  });

  it('at phone width, starts at the view’s left margin', () => {
    const phone = { ...frame, viewRight: 390, width: 374, anchorX: 300 };
    expect(popoverPlacement(phone).left).toBe(marginPx);
  });

  it('sits above the lane when the window has no room below and there is room above', () => {
    const low = { ...frame, laneTop: 700, laneBottom: 756 };
    expect(popoverPlacement(low).top).toBe(700 - gapPx - 260);
  });

  it('where neither side fits, clamps inside the window so Apply and Cancel stay on screen', () => {
    const cramped = { ...frame, laneTop: 100, laneBottom: 156, viewportHeight: 300 };
    const at = popoverPlacement(cramped);
    expect(at.top).toBe(300 - marginPx - 260);
    expect(at.top).toBeGreaterThanOrEqual(marginPx);
    expect(at.top + 260).toBeLessThanOrEqual(300 - marginPx);
    expect(at.maxHeight).toBeNull();
  });

  it('caps a panel taller than the window at the window less both margins, from the top margin', () => {
    const short = { ...frame, laneTop: 100, laneBottom: 156, viewportHeight: 200 };
    expect(popoverPlacement(short)).toEqual({
      left: 400,
      top: marginPx,
      maxHeight: 200 - 2 * marginPx,
    });
  });

  it('stays inside the window when the lane itself is scrolled past either edge', () => {
    const offBottom = { ...frame, laneTop: 298, laneBottom: 354, viewportHeight: 220 };
    expect(popoverPlacement(offBottom).top).toBe(marginPx);
    const offTop = { ...frame, laneTop: -120, laneBottom: -64 };
    expect(popoverPlacement(offTop).top).toBe(marginPx);
  });

  it('never caps below zero in a window narrower than its margins', () => {
    const tiny = { ...frame, viewportHeight: marginPx };
    expect(popoverPlacement(tiny).maxHeight).toBe(0);
  });
});

describe('Apply: one undo step', () => {
  const slot = AUTOMATION_PART.slot;
  const target = lanesOf(AUTOMATION_PART)[0]!.target;

  function openConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
    const model = new DocumentModel(AUTOMATION_DOCUMENT);
    const host: ContextHost = {
      apply: (_partial: DocumentPartial): ApplyResult => ({ ok: true, ignored: [] }),
      build: () => Promise.resolve(),
      isBuilding: false,
      capturePattern: () => null,
      part: () => null,
    };
    const ctx = new AppContext<TabPanel>({
      host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
      model,
      notify: () => undefined,
    });
    ctx.addTab('song', { hidden: false }, () => {});
    return { ctx, model };
  }
  const pointsIn = (model: DocumentModel): readonly AutomationPoint[] | undefined =>
    model.doc.parts.find((p) => p.slot === slot)?.automation?.find((l) => l.target === target)
      ?.points;

  it('commits the stamped lane once, and undo restores the exact previous points', () => {
    const { ctx, model } = openConsole();
    const before = pointsIn(model)!;
    const over = range(BAR / 2, BAR);
    const opened = shapeDraft(level, before, over, DEFAULT_SHAPE_SETTINGS);
    const after = shapedPoints(before, over, stampedPoints(level, over, opened));
    withGesture('Square on Level', () => {
      ctx.change(automationChange(slot, withPoints(lanesOf(AUTOMATION_PART), target, after)));
    });
    expect(pointsIn(model)).toEqual(after);
    expect(ctx.undo()).toBe(true);
    expect(pointsIn(model)).toStrictEqual(before);
    expect(ctx.canUndo).toBe(false);
  });
});
