/**
 * The Arp card's step grid rules (windsor#137): the cell count per style and
 * chord, the cell edits, Rotate over the shown cells, Randomize touching only
 * them, a cell's slide, and the new knobs' defaults.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { ArpSpec, ArpStep, Harmony, HarmonyChord, StepModLane } from '@windsor/engine';
import {
  ARP_STEPS_MAX,
  ARRANGEMENT_VERSION,
  RATCHET_MAX,
  DEFAULT_ARP_CONFIG,
  VOICE_TARGET_PATHS,
  arpCellPitch,
  arpNote,
  chordAt,
  defaultArpSteps,
  partAt,
} from '@windsor/engine';
import {
  arpCellCount,
  arpCycleLabel,
  arpKindLabel,
  arpOctaveLabel,
  arpShownList,
  arpSlideAt,
  nextArpKind,
  randomArpCells,
  rotateArp,
} from './arpGridModel';
import { ARP_RANDOM } from './arpGridConstants';
import { DocumentModel } from './documentModel';
import { cycleOctave, toggleFlag, withStep } from './gridModel';
import { cycleStepRatchet, stepRatchet, takesRatchet } from './ratchetModel';
import { ARP_GRID_KNOBS, ARP_ROTATE_KNOB, GRID_ROTATE_KNOB } from './sequencerKnobTables';
import { type StepSlide, heldBySlide } from './stepModLaneModel';
import { loadBuiltIns } from './builtInLibrary';

// The built-in library loads on demand in the page; the knob test's song reads it.
beforeAll(() => loadBuiltIns());

const BAR = 1920;
/** C major: a triad for a bar, then a seventh chord. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'major',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: BAR, degree: 4, size: 4 },
  ],
};
const TRIAD = chordAt(HARMONY, 2 * BAR, 0) as HarmonyChord;
const SEVENTH = chordAt(HARMONY, 2 * BAR, BAR) as HarmonyChord;
const SPEC: ArpSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, octaves: 2 };
const REST: ArpStep = { kind: 'rest' };
const TIE: ArpStep = { kind: 'tie' };

const count = (over: Partial<ArpSpec>, chord: HarmonyChord | null = TRIAD): number =>
  arpCellCount({ ...SPEC, ...over }, HARMONY, chord);

/** A draw that plays back `values`, then fails the test if asked for more. */
function scripted(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error('draw past the script');
    return v;
  };
}

describe('the shown cell count (windsor#137 decision 1)', () => {
  it('is one cycle of the style over a triad stacked two, then three octaves', () => {
    expect(count({ style: 'up' })).toBe(6);
    expect(count({ style: 'upDown' })).toBe(10);
    expect(count({ style: 'conDiverge' })).toBe(10);
    expect(count({ style: 'up', octaves: 3 })).toBe(9);
    expect(count({ style: 'upDown', octaves: 3 })).toBe(16);
    expect(count({ style: 'conDiverge', octaves: 3 })).toBe(16);
  });

  it('follows the chord: a seventh chord has more notes', () => {
    expect(count({ style: 'up' }, SEVENTH)).toBe(8);
    expect(count({ style: 'downUp' }, SEVENTH)).toBe(14);
    expect(count({ style: 'random', octaves: 1 }, SEVENTH)).toBe(4);
  });

  it('is 0 with no chord, and never past the stored cells', () => {
    expect(count({}, null)).toBe(0);
    expect(count({ style: 'upDown', octaves: 4 }, SEVENTH)).toBeLessThanOrEqual(ARP_STEPS_MAX);
  });
});

describe('the Cycle label (windsor#370)', () => {
  it('names the count and the chord the card reads, in the key', () => {
    expect(arpCycleLabel(6, HARMONY, TRIAD)).toBe('6 cells · C maj');
    expect(arpCycleLabel(14, HARMONY, SEVENTH)).toBe('14 cells · G 7');
    // windsor#330: ♭VI major names its moved root.
    const flatVi = { start: 0, duration: BAR, degree: 5, size: 3, quality: 'maj', accidental: -1 };
    const chord = chordAt({ ...HARMONY, events: [flatVi] as Harmony['events'] }, BAR, 0);
    expect(arpCycleLabel(6, HARMONY, chord)).toBe('6 cells · G# maj');
  });

  it('is the count alone with no chord, and one cell is a cell', () => {
    expect(arpCycleLabel(0, HARMONY, null)).toBe('0 cells');
    expect(arpCycleLabel(1, HARMONY, TRIAD)).toBe('1 cell · C maj');
  });
});

describe('the cell edits (decision 2)', () => {
  it('cycles note → tie → rest → a plain note', () => {
    expect(nextArpKind(arpNote({ accent: true, octave: 1 }))).toEqual(TIE);
    expect(nextArpKind(TIE)).toEqual(REST);
    expect(nextArpKind(REST)).toEqual(arpNote());
  });

  it("toggles accent and slide and steps the octave within ±2, through the grid's operations", () => {
    expect(toggleFlag(arpNote(), 'accent')).toEqual(arpNote({ accent: true }));
    expect(toggleFlag(toggleFlag(arpNote(), 'slide'), 'slide')).toEqual(arpNote());
    expect(cycleOctave(arpNote({ octave: 2 }), 1)).toEqual(arpNote({ octave: 2 }));
    expect(cycleOctave(arpNote({ octave: -2 }), -1)).toEqual(arpNote({ octave: -2 }));
    expect(cycleOctave(arpNote(), -1)).toEqual(arpNote({ octave: -1 }));
    expect(toggleFlag(REST, 'accent')).toEqual(REST);
    expect(cycleOctave(TIE, 1)).toEqual(TIE);
    expect(withStep(defaultArpSteps(3), 1, REST)).toEqual([arpNote(), REST, arpNote()]);
  });

  it("drops a note's ratchet when it becomes a tie, and a rest becomes a plain note (decision 6)", () => {
    expect(nextArpKind(arpNote({ ratchet: 3, accent: true }))).toEqual(TIE);
    expect(nextArpKind(nextArpKind(TIE))).toEqual(arpNote());
  });

  it("cycles a note's ratchet ×1 → ×2 → ×3 → ×4 → ×1 and leaves a rest or a tie alone", () => {
    const rolls: number[] = [];
    let cell: ArpStep = arpNote({ accent: true });
    for (let i = 0; i < RATCHET_MAX; i++) {
      cell = cycleStepRatchet(cell);
      rolls.push(stepRatchet(cell));
    }
    expect(rolls).toEqual([2, 3, 4, 1]);
    expect(cell).toEqual(arpNote({ accent: true }));
    expect([takesRatchet(REST), takesRatchet(TIE), takesRatchet(arpNote())]).toEqual([
      false,
      false,
      true,
    ]);
    expect(cycleStepRatchet(REST)).toBe(REST);
    expect(cycleStepRatchet(TIE)).toBe(TIE);
    // Oct, accent and slide keep the roll.
    const rolled = arpNote({ ratchet: 2 });
    expect(stepRatchet(cycleOctave(toggleFlag(rolled, 'slide'), 1))).toBe(2);
  });

  it('labels a cell and its octave', () => {
    expect([arpKindLabel(arpNote()), arpKindLabel(TIE), arpKindLabel(REST)]).toEqual([
      '♪',
      '—',
      '·',
    ]);
    expect([arpOctaveLabel(0), arpOctaveLabel(2), arpOctaveLabel(-1)]).toEqual(['oct', '+2', '-1']);
  });
});

describe('Rotate over the shown cells (decision 4)', () => {
  const steps = defaultArpSteps().map((_, i) => arpNote({ accent: i === 0, slide: i === 5 }));
  const lane: StepModLane = {
    param: 'filter.cutoff',
    values: Array.from({ length: ARP_STEPS_MAX }, (_, i) => i / 100),
  };

  it('turns the first `count` cells and their lane values, and leaves the rest', () => {
    const turned = rotateArp({ steps, lanes: [lane] }, 1, 6);
    expect(turned.steps[0]).toEqual(steps[5]);
    expect(turned.steps[1]).toEqual(steps[0]);
    expect(turned.steps.slice(6)).toEqual(steps.slice(6));
    expect(turned.lanes[0]?.values.slice(0, 3)).toEqual([0.05, 0, 0.01]);
    expect(turned.lanes[0]?.values.slice(6)).toEqual(lane.values.slice(6));
  });

  it("carries each cell's ratchet with it (windsor#370)", () => {
    const rolled = steps.map((cell, i) => (i === 2 ? arpNote({ ratchet: 3 }) : cell));
    const turned = rotateArp({ steps: rolled, lanes: [] }, 1, 6);
    expect(turned.steps[3]).toEqual(arpNote({ ratchet: 3 }));
    expect(stepRatchet(turned.steps[3])).toBe(3);
    expect(stepRatchet(turned.steps[2])).toBe(1);
    expect(rotateArp(turned, -1, 6).steps).toEqual(rolled);
  });

  it('goes back with the opposite turn, and does nothing with no cells shown', () => {
    const there = rotateArp({ steps, lanes: [lane] }, -4, 10);
    expect(rotateArp(there, 4, 10)).toEqual({ steps, lanes: [lane] });
    expect(rotateArp({ steps, lanes: [lane] }, 3, 0)).toEqual({ steps, lanes: [lane] });
  });

  it("is the grid's Rotate knob, ±16", () => {
    expect(ARP_ROTATE_KNOB).toBe(GRID_ROTATE_KNOB);
    expect([ARP_ROTATE_KNOB.min, ARP_ROTATE_KNOB.max]).toEqual([-16, 16]);
  });
});

describe('Randomize (decision 5)', () => {
  const written = defaultArpSteps().map((_, i) => (i >= 6 ? TIE : arpNote()));

  it('rerolls only the shown cells', () => {
    const rolled = randomArpCells(written, 6, Math.random);
    expect(rolled).toHaveLength(ARP_STEPS_MAX);
    expect(rolled.slice(6)).toEqual(written.slice(6));
  });

  it('draws a rest, a tie or a note with accent, slide, an octave and a roll, seven draws a cell', () => {
    const { rest, tie, flag, octave, ratchet } = ARP_RANDOM;
    const miss = 0.99;
    const rolled = randomArpCells(
      written,
      5,
      scripted([
        ...[rest / 2, miss, miss, miss, miss, ratchet / 2, 0],
        ...[rest + tie / 2, miss, miss, miss, miss, ratchet / 2, 0],
        ...[miss, flag / 2, miss, octave / 2, 0, miss, 0],
        ...[miss, miss, flag / 2, octave / 2, miss, miss, 0],
        ...[miss, miss, miss, miss, miss, ratchet / 2, miss],
      ]),
    );
    expect(rolled.slice(0, 5)).toEqual([
      REST,
      TIE,
      arpNote({ accent: true, octave: -1 }),
      arpNote({ slide: true, octave: 1 }),
      arpNote({ ratchet: RATCHET_MAX }),
    ]);
  });

  it('rolls ×2 to ×RATCHET_MAX, each as likely, and never on a rest or a tie (windsor#370)', () => {
    const { ratchet } = ARP_RANDOM;
    const rollOf = (pick: number): ArpStep | undefined =>
      randomArpCells(written, 1, scripted([0.99, 0.99, 0.99, 0.99, 0.99, ratchet / 2, pick]))[0];
    expect(rollOf(0)).toEqual(arpNote({ ratchet: 2 }));
    expect(rollOf(0.5)).toEqual(arpNote({ ratchet: 3 }));
    expect(rollOf(0.999)).toEqual(arpNote({ ratchet: RATCHET_MAX }));
    for (const cell of randomArpCells(written, ARP_STEPS_MAX, Math.random)) {
      if (cell.kind !== 'note') expect(cell).not.toHaveProperty('ratchet');
      else if (cell.ratchet !== undefined) {
        expect(cell.ratchet).toBeGreaterThanOrEqual(2);
        expect(cell.ratchet).toBeLessThanOrEqual(RATCHET_MAX);
      }
    }
  });

  it('keeps the ratchets past the shown cells', () => {
    const rolledPast = written.map((cell, i) => (i >= 6 ? arpNote({ ratchet: 3 }) : cell));
    expect(randomArpCells(rolledPast, 6, Math.random).slice(6)).toEqual(rolledPast.slice(6));
  });

  it('keeps every note within the ±1 octave the table allows', () => {
    const rolled = randomArpCells(written, ARP_STEPS_MAX, Math.random);
    for (const cell of rolled) {
      if (cell.kind === 'note') expect(Math.abs(cell.octave)).toBeLessThanOrEqual(1);
    }
  });
});

describe("a cell's slide over the shown cycle", () => {
  const slide = arpNote({ slide: true });
  /** Up over three notes a fifth apart, so every pair of cells differs. */
  const WIDE = [48, 55, 62];
  const at = (steps: ArpStep[], index: number, list = WIDE, skipChance = 0) =>
    arpSlideAt({ steps, skipChance, style: 'up' }, index, list);

  it('hands the voice over after a note, walking back over ties', () => {
    expect(at([arpNote(), slide, arpNote()], 1)).toEqual({ kind: 'retarget', when: 'always' });
    expect(at([arpNote(), TIE, slide], 2)).toEqual({ kind: 'retarget', when: 'always' });
    expect(at([arpNote(), slide, arpNote()], 1, WIDE, 0.5)).toEqual({
      kind: 'retarget',
      when: 'skip',
    });
  });

  it('holds nothing after a rest or past the shown cells, and only once wrapped at cell 1', () => {
    expect(at([REST, slide], 1, [48, 55])).toEqual({ kind: 'none', when: 'always' });
    expect(at([arpNote(), slide], 1, [48])).toEqual({ kind: 'none', when: 'always' });
    expect(at([slide, arpNote()], 0, [48, 55])).toEqual({ kind: 'retarget', when: 'wrap' });
  });

  it('is a sustain when an octave shift lands the slide on the pitch already held', () => {
    // A two-octave triad under Converge walks C, G', E, E', G, C': cells 2
    // and 3 are E and E' an octave apart, and cell 2 up an octave is E'.
    const spec = { ...SPEC, style: 'converge' as const };
    const list = arpShownList(spec, HARMONY, TRIAD);
    const e = list[1] as number;
    const pitch = (k: number, octave = 0): number | null =>
      arpCellPitch('converge', k, list, octave);
    expect([pitch(2), pitch(3), pitch(2, 1)]).toEqual([e, e + 12, e + 12]);
    const steps = [arpNote(), arpNote(), arpNote({ octave: 1 }), slide, arpNote(), arpNote()];
    const slideOf = (cells: ArpStep[], index: number): StepSlide =>
      arpSlideAt({ ...spec, steps: cells, skipChance: 0 }, index, list);
    expect(slideOf(steps, 3)).toEqual({ kind: 'same', when: 'always' });
    // Unshifted it moves up the octave: a retarget.
    expect(slideOf(withStep(steps, 2, arpNote()), 3)).toEqual({ kind: 'retarget', when: 'always' });
    // No lane value on that cell plays, as the engine sends it no note-on.
    for (const param of VOICE_TARGET_PATHS) {
      expect(heldBySlide(slideOf(steps, 3), param), param).toBe('held');
    }
  });

  it('under a random style, leaves whether the slide moves to the run', () => {
    const steps = [arpNote(), slide, arpNote()];
    for (const style of ['random', 'randomOther', 'randomOnce'] as const) {
      const drawn = arpSlideAt({ steps, skipChance: 0, style }, 1, WIDE);
      expect(drawn, style).toEqual({ kind: 'either', when: 'always' });
      expect(heldBySlide(drawn, 'filter.cutoff')).toBe('depends');
      expect(heldBySlide(drawn, 'ops.0.feedback')).toBe('held');
    }
    // Over one note every draw is that note: a slide onto it is a sustain.
    expect(arpSlideAt({ steps: [slide], skipChance: 0, style: 'random' }, 0, [48])).toEqual({
      kind: 'same',
      when: 'wrap',
    });
  });
});

describe("the grid's knobs on the Arp card", () => {
  it('default to what the normaliser writes for a bare arp part', () => {
    const bare = new DocumentModel({
      version: ARRANGEMENT_VERSION,
      parts: [{ slot: 0, name: 'Arp', preset: 'saw-arp', sequencer: { kind: 'arp' } }],
    });
    const sequencer = partAt(bare.doc, 0)!.sequencer;
    if (sequencer.kind !== 'arp') throw new Error('not an arp');
    expect(ARP_GRID_KNOBS.map((entry) => entry.f)).toEqual([
      'skipChance',
      'accentVelocity',
      'accentMod',
    ]);
    for (const entry of ARP_GRID_KNOBS) {
      expect(entry.o.def, entry.f).toBe(Reflect.get(sequencer, entry.f));
      expect([entry.o.min, entry.o.max]).toEqual([0, 1]);
    }
  });
});
