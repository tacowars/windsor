/**
 * The Parametric EQ under a lane (windsor#397, record
 * `2026-10-01-song-automation-lanes` decision 6), over the automation
 * fixture's hat part and its EQ: a band's Freq, Gain and Q knobs lock while a
 * lane on the field is on, and an off band or a cut's gain stays free; the
 * curve draws a held field at its lane's value; a drag on a held point, or a
 * curve edit of a held field, is refused by the lane's name.
 */
import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_EQ_ID,
  AUTOMATION_PART,
} from '@windsor/engine/__fixtures__/automationSong';
import {
  INSERT_AUTOMATION_FIELDS,
  TICKS_PER_BAR,
  songTicksOf,
  type ArrangementDocument,
  type AutomationLane,
  type DocumentPart,
  type EqBand,
  type EqSpec,
} from '@windsor/engine';
import type { AppCtx } from './context';
import type { EqLanes } from './eqAutomation';
import {
  EQ_DRAG_FIELDS,
  EQ_LANE_FIELDS,
  eqBandField,
  eqChangedFields,
  eqEditRefusal,
  eqHeldName,
  eqShownSpec,
  sameLaneFields,
} from './eqAutomation';
import { doubleClickEdit } from './eqCurveInput';
import { eqPlot, pointAt, withBand } from './eqCurveModel';
import { insertFieldLock } from './insertKnobs';
import { knobSongTick } from './knobAutomation';

const BAR = TICKS_PER_BAR;
const SAMPLE_RATE = 48000;

/** A lane on `field` of the hat's EQ, `from` at tick 0 to `to` at bar 3. */
const lane = (field: string, from: number, to: number, on = true): AutomationLane => ({
  target: `insert.${AUTOMATION_EQ_ID}.${field}`,
  on,
  points: [
    { tick: 0, value: from, bend: 0 },
    { tick: 2 * BAR, value: to, bend: 0 },
  ],
});

/** The hat part with `lanes` on its EQ, its other lanes kept. */
const withLanes = (lanes: readonly AutomationLane[]): DocumentPart => ({
  ...AUTOMATION_PART,
  automation: [...(AUTOMATION_PART.automation ?? []), ...lanes],
});

const eqOf = (part: DocumentPart): EqSpec & { id?: string } => {
  const spec = part.strip.inserts.find((s) => s.id === AUTOMATION_EQ_ID);
  if (spec?.kind !== 'eq') throw new Error('the fixture’s EQ');
  return spec;
};

const lanesAt = (part: DocumentPart, tick = 0): EqLanes => ({
  part,
  insert: eqOf(part),
  tick,
});

/** Band 3 (index 2) is an on bell in the fixture's EQ; band 8 (index 7) is an off high cut. */
const BELL = 2;
const OFF_CUT = 7;

describe('an EQ band knob', () => {
  const part = withLanes([lane(eqBandField(BELL, 'freq'), 300, 1200)]);
  const doc: ArrangementDocument = {
    ...AUTOMATION_DOCUMENT,
    parts: AUTOMATION_DOCUMENT.parts.map((p) => (p.slot === part.slot ? part : p)),
  };
  const ctx = (position: number): AppCtx =>
    ({ model: { doc }, transport: { position: () => position } }) as unknown as AppCtx;
  const index = part.strip.inserts.findIndex((s) => s.id === AUTOMATION_EQ_ID);
  const lockOf = (field: string, position = 0): number | undefined =>
    insertFieldLock(ctx(position), part.slot, index, field).automation?.()?.value;

  it('names a catalogued field for each band knob', () => {
    const catalogued = new Set(INSERT_AUTOMATION_FIELDS.eq.map((row) => row.target));
    eqOf(part).bands.forEach((_, i) => {
      for (const f of EQ_LANE_FIELDS) expect(catalogued.has(eqBandField(i, f))).toBe(true);
    });
  });

  it('locks while its lane is on, at the lane’s value, and follows a song wrap', () => {
    expect(lockOf(eqBandField(BELL, 'freq'))).toBe(300);
    expect(lockOf(eqBandField(BELL, 'freq'), 2 * BAR)).toBe(1200);
    expect(lockOf(eqBandField(BELL, 'freq'), songTicksOf(doc))).toBe(300);
    expect(lockOf(eqBandField(BELL, 'gain'))).toBeUndefined();
  });

  it('stays free on an off band, and on a cut’s gain', () => {
    const offs = withLanes([
      lane(eqBandField(OFF_CUT, 'freq'), 40, 80),
      lane(eqBandField(OFF_CUT, 'gain'), -3, 3),
    ]);
    expect(eqHeldName(lanesAt(offs), OFF_CUT)).toBeNull();
    const cut = { ...eqOf(offs).bands[OFF_CUT]!, on: true };
    const onCut = {
      ...offs,
      strip: {
        ...offs.strip,
        inserts: offs.strip.inserts.map((s) =>
          s.id === AUTOMATION_EQ_ID ? { ...s, ...withBand(eqOf(offs), OFF_CUT, cut) } : s,
        ),
      },
    };
    expect(eqHeldName(lanesAt(onCut), OFF_CUT, ['freq'])).toBe('Band 8 freq');
    expect(eqHeldName(lanesAt(onCut), OFF_CUT, ['gain'])).toBeNull();
  });
});

describe('the EQ curve under a lane', () => {
  const part = withLanes([lane(eqBandField(BELL, 'freq'), 300, 1200)]);
  const spec = eqOf(part);

  it('draws a held field at its lane’s value, and the stored spec while none is held', () => {
    const shown = eqShownSpec(lanesAt(part, 2 * BAR), spec);
    expect(shown.bands[BELL]!.freq).toBe(1200);
    expect(spec.bands[BELL]!.freq).toBe(250);
    expect(shown.bands[BELL + 1]).toBe(spec.bands[BELL + 1]);
    expect(eqShownSpec(lanesAt(AUTOMATION_PART), spec)).toBe(spec);
  });

  it('follows the lane after the song wraps', () => {
    const tick = knobSongTick(AUTOMATION_DOCUMENT, songTicksOf(AUTOMATION_DOCUMENT));
    expect(eqShownSpec(lanesAt(part, tick), spec).bands[BELL]!.freq).toBe(300);
  });

  it('redraws only when a lane’s field moves', () => {
    const a = eqShownSpec(lanesAt(part, 0), spec);
    expect(sameLaneFields(a, eqShownSpec(lanesAt(part, 0), spec))).toBe(true);
    expect(sameLaneFields(a, eqShownSpec(lanesAt(part, BAR), spec))).toBe(false);
  });

  it('refuses a drag on a point whose frequency or gain a lane holds, by the lane’s name', () => {
    expect(eqHeldName(lanesAt(part), BELL, EQ_DRAG_FIELDS)).toBe('Band 3 freq');
    expect(eqHeldName(lanesAt(part), BELL + 1, EQ_DRAG_FIELDS)).toBeNull();
    const q = withLanes([lane(eqBandField(BELL, 'q'), 1, 2)]);
    expect(eqHeldName(lanesAt(q), BELL, EQ_DRAG_FIELDS)).toBeNull();
    expect(eqHeldName(lanesAt(q), BELL, ['q'])).toBe('Band 3 Q');
  });

  it('refuses a curve edit of a held field, and lets every other edit through', () => {
    const band = (patch: Partial<EqBand>): EqSpec =>
      withBand(spec, BELL, { ...spec.bands[BELL]!, ...patch });
    expect(eqEditRefusal(lanesAt(part), spec, band({ freq: 900 }))).toBe('Band 3 freq');
    expect(eqEditRefusal(lanesAt(part), spec, band({ gain: 3 }))).toBeNull();
    expect(eqEditRefusal(lanesAt(part), spec, band({ type: 'lowshelf' }))).toBeNull();
    const other = withBand(spec, BELL + 1, { ...spec.bands[BELL + 1]!, freq: 3000 });
    expect(eqEditRefusal(lanesAt(part), spec, other)).toBeNull();
    expect(eqChangedFields(spec.bands[BELL]!, { ...spec.bands[BELL]!, q: 2 })).toEqual(['q']);
  });

  it('resets a gain on the point as drawn, and keeps the stored frequency', () => {
    const at = lanesAt(part, 2 * BAR);
    const plot = eqPlot(12, SAMPLE_RATE);
    const stored = withBand(spec, BELL, { ...spec.bands[BELL]!, gain: 6 });
    const host = {
      spec: () => stored,
      shown: () => eqShownSpec(at, stored),
      plot: () => plot,
      sampleRate: () => SAMPLE_RATE,
    };
    const drawn = pointAt(host.shown(), BELL, plot, SAMPLE_RATE);
    const done = doubleClickEdit(host, drawn);
    expect(done.kind).toBe('reset');
    if (done.kind === 'full') return;
    expect(done.band).toBe(BELL);
    expect(done.spec.bands[BELL]).toEqual({ ...stored.bands[BELL]!, gain: 0 });
    expect(done.spec.bands.filter((b, i) => b !== stored.bands[i])).toHaveLength(1);
  });
});
