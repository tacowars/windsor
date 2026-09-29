/**
 * The arp's step grid (windsor#127): the cycle-length rule, checked against
 * the walk the arpeggiator really plays, the longest cycle derived from the
 * chord and octave limits, the default cells and the config check.
 */
import { describe, expect, it } from 'vitest';

import { ARP_OCTAVES_MAX, GRID_STEP_OCTAVE_MAX } from '../audioConstants';
import { CHORD_VOICINGS, CHORD_VOICING_IDS } from '../harmony/chordTables';
import { CHORD_SIZES } from '../harmony/chordTheory';
import { ARP_STYLES, DEFAULT_ARP_CONFIG, assertArpConfig, type ArpStyle } from './arpSequencer';
import { ARP_BOUNCE_STYLES, ARP_STEPS_MAX } from './arpStepConstants';
import { arpCycleLength, arpNote, defaultArpSteps, type ArpStep } from './arpSteps';
import { orderedIndex, type OrderedArpStyle } from './arpeggiator';
import type { StepModLane } from './stepModLanes';

const ORDERED = ARP_STYLES.filter(
  (s): s is OrderedArpStyle => !['random', 'randomOther', 'randomOnce'].includes(s),
);

/** The shortest `p` with the walk at `i + p` equal to the walk at `i` for every `i` it checks. */
function walkPeriod(style: OrderedArpStyle, length: number): number {
  const span = 4 * length;
  const walk = Array.from({ length: span * 2 }, (_, i) => orderedIndex(style, i, length));
  for (let p = 1; p <= span; p++) {
    if (walk.slice(0, span).every((v, i) => v === walk[i + p])) return p;
  }
  return -1;
}

describe('arpCycleLength (epic windsor#126 decision 2)', () => {
  it('is L for the straight and random styles, 2L − 2 for the bounces when L > 2', () => {
    for (const style of ARP_STYLES) {
      const bounce = ARP_BOUNCE_STYLES.includes(style);
      for (let length = 3; length <= 16; length++) {
        expect(arpCycleLength(style, length), `${style} over ${length}`).toBe(
          bounce ? 2 * length - 2 : length,
        );
      }
    }
    expect([...ARP_BOUNCE_STYLES].sort()).toEqual(['conDiverge', 'downUp', 'upDown']);
  });

  it('is L for every style over one or two notes', () => {
    for (const style of ARP_STYLES) {
      expect(arpCycleLength(style, 1), style).toBe(1);
      expect(arpCycleLength(style, 2), style).toBe(2);
    }
  });

  it("is the period of each ordered style's real walk", () => {
    for (const style of ORDERED) {
      for (let length = 1; length <= 16; length++) {
        expect(walkPeriod(style, length), `${style} over ${length}`).toBe(
          arpCycleLength(style, length),
        );
      }
    }
  });

  it('fits the longest possible cycle in ARP_STEPS_MAX cells', () => {
    // The most notes any voicing makes of any chord size. A voicing may add
    // notes beyond its chord's size (Octaves & 3rds voices a triad as four),
    // so this reads the voicings rather than trusting CHORD_SIZES alone.
    const voiced = Math.max(
      ...CHORD_SIZES.flatMap((size) => {
        const stack = Array.from({ length: size }, (_, k) => k * 3);
        return CHORD_VOICING_IDS.map((id) => CHORD_VOICINGS[id].voice(stack).length);
      }),
    );
    expect(voiced).toBe(Math.max(...CHORD_SIZES));
    const longestList = voiced * ARP_OCTAVES_MAX;
    const longest = Math.max(...ARP_STYLES.map((s: ArpStyle) => arpCycleLength(s, longestList)));
    expect(longest).toBe(30);
    expect(longest).toBeLessThanOrEqual(ARP_STEPS_MAX);
  });
});

describe('the arp cells (windsor#127)', () => {
  it('a new arp carries ARP_STEPS_MAX plain notes, no lanes, the grid accents and no skip', () => {
    expect(defaultArpSteps()).toHaveLength(ARP_STEPS_MAX);
    for (const cell of defaultArpSteps()) {
      expect(cell).toEqual({ kind: 'note', octave: 0, accent: false, slide: false });
    }
    expect(DEFAULT_ARP_CONFIG).toMatchObject({
      steps: defaultArpSteps(),
      lanes: [],
      accentVelocity: 0.2,
      accentMod: 1,
      skipChance: 0,
    });
    expect(() => assertArpConfig(DEFAULT_ARP_CONFIG)).not.toThrow();
  });

  it('assertArpConfig refuses a grid the normaliser would have corrected', () => {
    const steps = (cells: ArpStep[]): ArpStep[] => [
      ...cells,
      ...defaultArpSteps(ARP_STEPS_MAX - cells.length),
    ];
    const lane = (values: number[]): StepModLane => ({ param: 'filter.cutoff', values });
    const refused = [
      { steps: defaultArpSteps(ARP_STEPS_MAX - 1) },
      { steps: defaultArpSteps(ARP_STEPS_MAX + 1) },
      { steps: steps([arpNote({ octave: GRID_STEP_OCTAVE_MAX + 1 })]) },
      { steps: steps([arpNote({ octave: 0.5 })]) },
      { steps: steps([{ kind: 'hold' } as unknown as ArpStep]) },
      { lanes: [lane(new Array<number>(ARP_STEPS_MAX - 1).fill(0))] },
      { lanes: [lane(new Array<number>(ARP_STEPS_MAX).fill(2))] },
      { accentVelocity: 1.5 },
      { accentMod: -0.1 },
      { skipChance: Number.NaN },
    ];
    for (const over of refused) {
      expect(
        () => assertArpConfig({ ...DEFAULT_ARP_CONFIG, ...over }),
        JSON.stringify(over),
      ).toThrow(RangeError);
    }
    const edited = {
      ...DEFAULT_ARP_CONFIG,
      steps: steps([{ kind: 'rest' }, { kind: 'tie' }, arpNote({ octave: -2, accent: true })]),
      lanes: [lane(new Array<number>(ARP_STEPS_MAX).fill(-1))],
      skipChance: 1,
    };
    expect(() => assertArpConfig(edited)).not.toThrow();
  });
});
