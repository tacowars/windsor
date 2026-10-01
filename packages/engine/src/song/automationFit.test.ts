/**
 * Lanes fitted to the song's length (windsor#342, record
 * `2026-10-01-song-automation-lanes` decision 15): a shorter song cuts each
 * lane at its new end with the value it had there, keeping the curve's shape
 * up to it; a longer one changes nothing. The document path
 * (`makeArrangement`) and the player's (`fitTimelines`) fit the same way.
 */
import { describe, expect, it } from 'vitest';

import { AUTOMATION_DOCUMENT, AUTOMATION_PART } from '../__fixtures__/automationSong';
import { FULL_SLOT } from '../__fixtures__/fullArrangement';
import { valueAt } from '../automation/automationEvaluate';
import type { AutomationLane, AutomationPoint } from '../automation/automationLane';
import { catalogRow } from '../automation/automationTargets';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import type { Arrangement } from './arrangement';
import {
  makeArrangement,
  type ArrangementDocument,
  type DocumentPart,
} from './arrangementDocument';
import { fitPoints } from './automationNormalise';
import { fitTimelines } from './timelineNormalise';

const { hat } = FULL_SLOT;
const BAR = TICKS_PER_BAR;

const hatOf = (document: { readonly parts: readonly unknown[] }): DocumentPart =>
  (document.parts as DocumentPart[]).find((part) => part.slot === hat)!;

/** `AUTOMATION_DOCUMENT` at `bars`, with the hat's lanes replaced by `lanes` when given. */
function song(bars: number, lanes?: readonly AutomationLane[]): ArrangementDocument {
  return {
    ...AUTOMATION_DOCUMENT,
    transport: { ...AUTOMATION_DOCUMENT.transport, bars },
    parts: AUTOMATION_DOCUMENT.parts.map((part) =>
      part.slot === hat && lanes ? { ...part, automation: lanes } : part,
    ),
  };
}

const point = (tick: number, value: number, bend = 0): AutomationPoint => ({ tick, value, bend });
const level = catalogRow('strip.level')!;
const cutoff = catalogRow('voice.filter.cutoff')!;

/** A level fade bent hard over four bars, and a cutoff sweep up and down. */
const BENT: readonly AutomationLane[] = [
  { target: 'strip.level', on: true, points: [point(0, 0.05, 0.7), point(4 * BAR, 1.5)] },
  {
    target: 'voice.filter.cutoff',
    on: true,
    points: [point(0, 100, -0.8), point(3 * BAR, 9000, 0.5), point(4 * BAR, 300)],
  },
];

describe('a shorter song', () => {
  it('cuts a bent segment at the new end with its value there, keeping its shape', () => {
    const result = makeArrangement(song(2, BENT));
    const [fade, sweep] = hatOf(result.document).automation!;
    const end = 2 * BAR;
    expect(fade!.points).toEqual([
      point(0, 0.05, 0.7),
      point(end, valueAt(level, BENT[0]!.points, end)),
    ]);
    expect(sweep!.points).toEqual([
      point(0, 100, -0.8),
      point(end, valueAt(cutoff, BENT[1]!.points, end)),
    ]);
    for (let tick = 0; tick <= end; tick += 4) {
      expect(valueAt(level, fade!.points, tick)).toBeCloseTo(
        valueAt(level, BENT[0]!.points, tick),
        9,
      );
      expect(valueAt(cutoff, sweep!.points, tick)).toBeCloseTo(
        valueAt(cutoff, BENT[1]!.points, tick),
        6,
      );
    }
    expect(result.corrections).toContain(
      `parts[1].automation[0].points: points past the song's end (tick ${end}) — fitted to it`,
    );
  });

  it('adds no point where one already sits on the end, a step included', () => {
    const points = [point(0, 0), point(BAR, -1), point(BAR, 1), point(2 * BAR, 0.5)];
    expect(fitPoints(catalogRow('strip.pan')!, points, BAR)).toEqual([
      point(0, 0),
      point(BAR, -1),
      point(BAR, 1),
    ]);
  });

  it('holds the first value at the end when every point is past it', () => {
    const points = [point(3 * BAR, 0.25, 0.5), point(4 * BAR, 1)];
    expect(fitPoints(level, points, BAR)).toEqual([point(BAR, 0.25)]);
  });

  it('is idempotent: a fitted lane normalises unchanged', () => {
    const first = makeArrangement(song(2, BENT)).document;
    const second = makeArrangement(JSON.parse(JSON.stringify(first)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toEqual(first);
  });
});

describe('a longer song', () => {
  it('changes nothing: the last value holds', () => {
    const result = makeArrangement(song(8));
    expect(hatOf(result.document)).toEqual(AUTOMATION_PART);
    expect(result.corrections.filter((line) => line.includes('automation'))).toEqual([]);
  });
});

describe('fitTimelines', () => {
  const arrangement = (bars: number): Arrangement => song(bars, BENT) as unknown as Arrangement;

  it("fits a part's lanes as the document path does", () => {
    const fitted = fitTimelines(arrangement(2));
    expect(hatOf(fitted).automation).toEqual(
      hatOf(makeArrangement(song(2, BENT)).document).automation,
    );
  });

  it('leaves lanes that fit, and parts without lanes, as they are', () => {
    const fitted = fitTimelines(arrangement(4));
    expect(hatOf(fitted).automation).toBe(BENT);
    for (const part of fitted.parts.filter((each) => each.slot !== hat)) {
      expect(part).not.toHaveProperty('automation');
    }
  });

  it('never drops a lane it cannot find a row for: the normaliser does that', () => {
    const stray: AutomationLane = {
      target: 'insert.gone.drive',
      on: true,
      points: [point(0, 0), point(4 * BAR, 10)],
    };
    const fitted = fitTimelines(song(2, [stray]) as unknown as Arrangement);
    expect(hatOf(fitted).automation).toEqual([stray]);
  });
});
