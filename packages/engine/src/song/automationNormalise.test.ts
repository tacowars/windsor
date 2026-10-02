/**
 * A part's automation lanes in the song format (windsor#342, record
 * `2026-10-01-song-automation-lanes` decisions 1–4, 14 and 15): kept through
 * normalise, export and import; absent when there are none; and each case
 * of decision 2 corrected, never refused. Fitting to a new length is
 * `automationFit.test.ts`'s.
 */
import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_EQ_ID,
  AUTOMATION_LANES,
  AUTOMATION_PART,
  AUTOMATION_TAPE_ID,
} from '../__fixtures__/automationSong';
import { FULL_DOCUMENT, FULL_SLOT, FULL_SONG_TICKS } from '../__fixtures__/fullArrangement';
import { FM_LANES_MAX } from '../automation/automationTargetTables';
import type { AutomationLane } from '../automation/automationLane';
import { VOICE_AUTOMATION_ROWS, insertTargetRow } from '../automation/automationTargets';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { DEFAULT_TAPE } from '../inserts/tapeSpec';
import { mergeArrangement, type Arrangement } from './arrangement';
import {
  makeArrangement,
  type ArrangementDocument,
  type DocumentPart,
} from './arrangementDocument';

const { hat } = FULL_SLOT;

const hatOf = (document: ArrangementDocument): DocumentPart =>
  document.parts.find((part) => part.slot === hat)!;

/** `AUTOMATION_DOCUMENT` with the hat's lanes replaced by `raw`, normalised. */
function withLanes(raw: unknown): { lanes: unknown; corrections: string[] } {
  const document = {
    ...AUTOMATION_DOCUMENT,
    parts: AUTOMATION_DOCUMENT.parts.map((part) =>
      part.slot === hat ? { ...part, automation: raw } : part,
    ),
  };
  const result = makeArrangement(document);
  expect(result.usable).toBe(true);
  return { lanes: hatOf(result.document).automation, corrections: result.corrections };
}

const lane = (target: string, points: unknown[], extra: object = {}): Record<string, unknown> => ({
  target,
  on: true,
  points,
  ...extra,
});
const point = (tick: number, value: number, bend = 0) => ({ tick, value, bend });

describe('a song with lanes', () => {
  it('keeps strip, insert and voice lanes, on and off, steps and bends, through normalise', () => {
    const result = makeArrangement(AUTOMATION_DOCUMENT);
    expect(result.corrections).toEqual([]);
    expect(hatOf(result.document)).toEqual(AUTOMATION_PART);
  });

  it('round-trips through export and import unchanged', () => {
    const first = makeArrangement(AUTOMATION_DOCUMENT).document;
    const second = makeArrangement(JSON.parse(JSON.stringify(first)));
    expect(second.corrections).toEqual([]);
    expect(second.document).toEqual(first);
    expect(hatOf(second.document).automation).toEqual(AUTOMATION_LANES);
  });

  it('normalises a song without lanes exactly as before: no part gains the key', () => {
    const result = makeArrangement(FULL_DOCUMENT);
    expect(result.corrections).toEqual([]);
    expect(result.document).toEqual(FULL_DOCUMENT);
    for (const part of result.document.parts) expect(part).not.toHaveProperty('automation');
  });

  it('normalises an empty list to absent, with nothing to report', () => {
    const { lanes, corrections } = withLanes([]);
    expect(lanes).toBeUndefined();
    expect(corrections).toEqual([]);
    expect(hatOf(makeArrangement(AUTOMATION_DOCUMENT).document)).toHaveProperty('automation');
  });

  it('drops a list that is not one, reported', () => {
    const { lanes, corrections } = withLanes({ target: 'strip.level' });
    expect(lanes).toBeUndefined();
    expect(corrections.join('\n')).toMatch(/automation: .* is not a list of lanes/);
  });

  it('keeps the song version', () => {
    expect(makeArrangement(AUTOMATION_DOCUMENT).document.version).toBe(ARRANGEMENT_VERSION);
  });
});

describe('the target', () => {
  it.each([
    ['a target that does not parse', 'strip.volume', /names no automation target/],
    ['a target that is not a string', 42, /names no automation target/],
    ['an insert id the strip does not have', 'insert.gone.drive', /no insert "gone"/],
    ['a field its kind does not list', `insert.${AUTOMATION_EQ_ID}.drive`, /eq has no .*"drive"/],
    ['a voice path the catalog lacks', 'voice.ops.0.ratio', /names no automation target/],
  ])('drops a lane on %s, reported', (_, target, message) => {
    const { lanes, corrections } = withLanes([
      lane(target as string, [point(0, 0.5)]),
      lane('strip.pan', [point(0, 0.25)]),
    ]);
    expect(lanes).toEqual([lane('strip.pan', [point(0, 0.25)])]);
    expect(corrections.join('\n')).toMatch(message);
  });

  it('keeps a lane on a field its kind lists but its settings leave unread', () => {
    // Unsplit Tape reads `wear`, not `wow`: the fixture's `wow` lane survives regardless.
    const unsplit = withLanes([lane(`insert.${AUTOMATION_TAPE_ID}.wow`, [point(0, 25)])]);
    expect(unsplit.lanes).toHaveLength(1);
    expect(unsplit.corrections).toEqual([]);
    const split: ArrangementDocument = {
      ...AUTOMATION_DOCUMENT,
      parts: AUTOMATION_DOCUMENT.parts.map((part) =>
        part.slot === hat
          ? {
              ...AUTOMATION_PART,
              strip: {
                ...AUTOMATION_PART.strip,
                inserts: [{ ...DEFAULT_TAPE, split: true, id: AUTOMATION_TAPE_ID }],
              },
              automation: [lane(`insert.${AUTOMATION_TAPE_ID}.wear`, [point(0, 40)])],
            }
          : part,
      ),
    } as ArrangementDocument;
    const result = makeArrangement(split);
    expect(result.corrections).toEqual([]);
    expect(hatOf(result.document).automation).toEqual([
      lane(`insert.${AUTOMATION_TAPE_ID}.wear`, [point(0, 40)]),
    ]);
  });

  it('keeps the first of two lanes on one target', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.level', [point(0, 0.5)]),
      lane('strip.level', [point(0, 1)]),
    ]);
    expect(lanes).toEqual([lane('strip.level', [point(0, 0.5)])]);
    expect(corrections.join('\n')).toMatch(/an earlier lane moves strip.level/);
  });

  it('drops the ninth voice lane, in list order, and caps no other kind', () => {
    const voice = VOICE_AUTOMATION_ROWS.slice(0, FM_LANES_MAX + 1).map((row) =>
      lane(row.target, [point(0, row.min)]),
    );
    const eqLanes = Array.from({ length: FM_LANES_MAX + 1 }, (_, band) => {
      const field = `bands.${band % FM_LANES_MAX}.${band < FM_LANES_MAX ? 'freq' : 'q'}`;
      return lane(`insert.${AUTOMATION_EQ_ID}.${field}`, [
        point(0, insertTargetRow('eq', field)!.min),
      ]);
    });
    const strip = ['strip.level', 'strip.pan', 'strip.send.a', 'strip.send.b'].map((target) =>
      lane(target, [point(0, 0)]),
    );
    const { lanes, corrections } = withLanes([...voice, ...eqLanes, ...strip]);
    expect(lanes).toEqual([...voice.slice(0, FM_LANES_MAX), ...eqLanes, ...strip]);
    expect(corrections).toEqual([
      `parts[1].automation[${FM_LANES_MAX}]: a part has at most ${FM_LANES_MAX} voice lanes — lane dropped`,
    ]);
  });
});

describe('the points', () => {
  it('drops a point with a field that is not a finite number', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.pan', [
        point(0, 0.5),
        { tick: Number.NaN, value: 0 },
        { tick: 10, value: '0.2' },
        { value: 0.1 },
        { tick: 20, value: 0.1, bend: Infinity },
      ]),
    ]);
    expect(lanes).toEqual([lane('strip.pan', [point(0, 0.5)])]);
    expect(corrections.filter((line) => /is not a point — dropped/.test(line))).toHaveLength(4);
  });

  it('clamps a tick to 0, a value to the row and a bend to −1..1; a missing bend is 0', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.pan', [
        { tick: -5, value: 3, bend: 4 },
        { tick: 50, value: -2 },
      ]),
    ]);
    expect(lanes).toEqual([lane('strip.pan', [point(0, 1, 1), point(50, -1, 0)])]);
    expect(corrections).toEqual([
      'parts[1].automation[0].points[0].tick: clamped -5 to 0',
      'parts[1].automation[0].points[0].value: clamped 3 to 1',
      'parts[1].automation[0].points[0].bend: clamped 4 to 1',
      'parts[1].automation[0].points[1].value: clamped -2 to -1',
    ]);
  });

  it('sorts points by tick, stably, so a step keeps its direction', () => {
    const { lanes } = withLanes([
      lane('strip.pan', [point(96, 0.5), point(48, -1), point(48, 1), point(0, 0)]),
    ]);
    expect(lanes).toEqual([
      lane('strip.pan', [point(0, 0), point(48, -1), point(48, 1), point(96, 0.5)]),
    ]);
  });

  it('keeps at most two points on one tick', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.pan', [point(48, -1), point(48, 0), point(48, 1), point(48, 0.5)]),
    ]);
    expect(lanes).toEqual([lane('strip.pan', [point(48, -1), point(48, 0)])]);
    expect(corrections).toEqual([
      'parts[1].automation[0].points: more than 2 points on one tick — extras dropped',
    ]);
  });

  it('keeps a fractional tick, where a stamped shape lands between ticks', () => {
    expect(withLanes([lane('strip.pan', [point(12.5, 0.1)])]).lanes).toEqual([
      lane('strip.pan', [point(12.5, 0.1)]),
    ]);
  });

  it('drops a lane left with no points, and one whose points are not a list', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.level', [{ tick: 'x', value: 1 }]),
      lane('strip.pan', []),
      lane('strip.send.a', 'none' as never),
      lane('strip.send.b', [point(0, 0.5)]),
    ]);
    expect(lanes).toEqual([lane('strip.send.b', [point(0, 0.5)])]);
    expect(corrections.filter((line) => /no points left — lane dropped/.test(line))).toHaveLength(
      3,
    );
  });

  it('keeps every point inside the song', () => {
    const { lanes } = withLanes([lane('strip.pan', [point(0, 0), point(FULL_SONG_TICKS, 1)])]);
    expect(lanes).toEqual([lane('strip.pan', [point(0, 0), point(FULL_SONG_TICKS, 1)])]);
  });
});

describe('on', () => {
  it('reads a missing on as true and keeps a present false', () => {
    const { lanes, corrections } = withLanes([
      { target: 'strip.level', points: [point(0, 1)] },
      lane('strip.pan', [point(0, 0)], { on: false }),
    ]);
    expect(lanes).toEqual([
      lane('strip.level', [point(0, 1)]),
      lane('strip.pan', [point(0, 0)], { on: false }),
    ]);
    expect(corrections).toEqual([]);
  });

  it('reads a junk on as true, reported, and drops an unknown key, reported', () => {
    const { lanes, corrections } = withLanes([
      lane('strip.level', [point(0, 1)], { on: 'no', colour: 'teal' }),
    ]);
    expect(lanes).toEqual([lane('strip.level', [point(0, 1)])]);
    expect(corrections).toEqual([
      'parts[1].automation[0].colour: unknown key dropped',
      'parts[1].automation[0].on: "no" is not a boolean — using true',
    ]);
  });
});

describe('edits through a partial', () => {
  const opened = makeArrangement(AUTOMATION_DOCUMENT).document;
  /** A document partial merged and renormalised, the way the console's merge does it. */
  const merged = (partial: object): ArrangementDocument => {
    const { merged: next } = mergeArrangement(opened as unknown as Arrangement, partial);
    return makeArrangement(next).document;
  };

  it('removing an insert removes its lanes, and undoing it brings both back', () => {
    const eqOnly = opened.parts.find((part) => part.slot === hat)!.strip.inserts.slice(1);
    const removed = merged({ parts: { [hat]: { strip: { inserts: eqOnly } } } });
    const lanes = hatOf(removed).automation!;
    expect(lanes.map((each) => each.target)).toEqual(
      AUTOMATION_LANES.map((each) => each.target).filter(
        (target) => !target.startsWith(`insert.${AUTOMATION_TAPE_ID}.`),
      ),
    );
    // Undo replaces the document with its snapshot: the insert and its lanes are both back.
    const undone = makeArrangement(opened);
    expect(undone.corrections).toEqual([]);
    expect(hatOf(undone.document)).toEqual(AUTOMATION_PART);
  });

  it('replaces the whole list', () => {
    const only: AutomationLane[] = [{ target: 'strip.pan', on: true, points: [point(0, 1)] }];
    expect(hatOf(merged({ parts: { [hat]: { automation: only } } })).automation).toEqual(only);
  });

  it("swapping the part's preset keeps its voice lanes", () => {
    const swapped = merged({ parts: { [hat]: { preset: 'kick' } } });
    expect(hatOf(swapped).preset).toBe('kick');
    expect(hatOf(swapped).automation).toEqual(AUTOMATION_LANES);
  });
});
