/**
 * The arp's step grid through the document normaliser (windsor#127): absent
 * fields are the plain grid, silently; a cell, a list or a lane the grid
 * would correct is corrected and reported the same way; and a region's own
 * arp pattern carries and normalises the same fields.
 */
import { describe, expect, it } from 'vitest';

import { GRID_STEP_OCTAVE_MAX } from '../audioConstants';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { ARP_STEPS_MAX } from '../sequencing/arpStepConstants';
import { arpNote, defaultArpSteps, type ArpStep } from '../sequencing/arpSteps';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { STEP_MOD_LANES_MAX } from '../worklet/fm/stepModTables';
import { song } from '../__fixtures__/documentCases';
import { FieldNormaliser } from './arrangementFields';
import { isShippable, makeArrangement } from './arrangementDocument';
import { normaliseSequencer } from './sequencerNormalise';

const PATH = 'parts[0].sequencer';

function arp(raw: Record<string, unknown>): {
  spec: Record<string, unknown>;
  corrections: string[];
} {
  const n = new FieldNormaliser();
  const spec = normaliseSequencer({ kind: 'arp', seed: 0, ...raw }, PATH, n);
  return { spec: spec as unknown as Record<string, unknown>, corrections: n.corrections };
}

/** `cells` followed by plain notes up to `ARP_STEPS_MAX`. */
const padded = (cells: ArpStep[]): ArpStep[] => [
  ...cells,
  ...defaultArpSteps(ARP_STEPS_MAX - cells.length),
];

const zeros = (): number[] => new Array<number>(ARP_STEPS_MAX).fill(0);

describe('the arp step grid through the normaliser (windsor#127)', () => {
  it('an arp with no grid fields is 32 plain notes, no lanes and the default accents, silently', () => {
    const { spec, corrections } = arp({});
    expect(corrections).toEqual([]);
    expect(spec).toStrictEqual({ kind: 'arp', ...DEFAULT_ARP_CONFIG });
    expect(spec.steps).toEqual(defaultArpSteps());
    expect(spec).toMatchObject({ lanes: [], accentVelocity: 0.2, accentMod: 1, skipChance: 0 });
  });

  it('keeps a written grid exactly', () => {
    const steps = padded([
      { kind: 'rest' },
      { kind: 'tie' },
      arpNote({ octave: -2, accent: true }),
      arpNote({ octave: 1, slide: true }),
    ]);
    const lanes = [{ param: 'filter.cutoff', values: zeros().map((_, i) => (i % 2) * 0.5) }];
    const written = { steps, lanes, accentVelocity: 0.7, accentMod: 0.3, skipChance: 0.25 };
    const { spec, corrections } = arp(written);
    expect(corrections).toEqual([]);
    expect(spec).toStrictEqual({ kind: 'arp', ...DEFAULT_ARP_CONFIG, ...written });
  });

  it('corrects a junk cell, an out-of-range octave and a degree, as the grid does', () => {
    const { spec, corrections } = arp({
      steps: padded([
        7 as unknown as ArpStep,
        { kind: 'hold' } as unknown as ArpStep,
        arpNote({ octave: 5 }),
        { kind: 'note', degree: 3, octave: 1, accent: 'yes', slide: false } as unknown as ArpStep,
        { kind: 'rest', accent: true } as unknown as ArpStep,
      ]),
    });
    expect(corrections).toEqual([
      `${PATH}.steps[0]: 7 is not an object — using defaults`,
      `${PATH}.steps[1].kind: "hold" is not one of rest|tie|note — using note`,
      `${PATH}.steps[2].octave: clamped 5 to ${GRID_STEP_OCTAVE_MAX}`,
      `${PATH}.steps[3].degree: unknown key dropped`,
      `${PATH}.steps[3].accent: "yes" is not a boolean — using false`,
      `${PATH}.steps[4].accent: unknown key dropped`,
    ]);
    expect((spec.steps as ArpStep[]).slice(0, 5)).toEqual([
      arpNote(),
      arpNote(),
      arpNote({ octave: GRID_STEP_OCTAVE_MAX }),
      arpNote({ octave: 1 }),
      { kind: 'rest' },
    ]);
  });

  it('pads a short list and trims a long one to 32 cells, and replaces a junk list, reported', () => {
    const long = arp({ steps: new Array(40).fill({ kind: 'rest' }) });
    expect(long.corrections).toEqual([
      `${PATH}.steps: 40 steps for ${ARP_STEPS_MAX} — resized with plain notes`,
    ]);
    expect(long.spec.steps).toEqual(new Array(ARP_STEPS_MAX).fill({ kind: 'rest' }));

    const short = arp({ steps: [{ kind: 'tie' }] });
    expect(short.corrections).toEqual([
      `${PATH}.steps: 1 steps for ${ARP_STEPS_MAX} — resized with plain notes`,
    ]);
    expect(short.spec.steps).toEqual(padded([{ kind: 'tie' }]));

    const junk = arp({ steps: 'all of them' });
    expect(junk.corrections).toEqual([
      `${PATH}.steps: "all of them" is not a list of steps — every step a plain note`,
    ]);
    expect(junk.spec.steps).toEqual(defaultArpSteps());
  });

  it('drops an unknown lane and a fifth one, and sizes each lane to 32 values, reported', () => {
    const { spec, corrections } = arp({
      lanes: [
        { param: 'volume', values: zeros() },
        { param: 'filter.cutoff', values: [0.5] },
        { param: 'filter.resonance', values: zeros() },
        { param: 'ops.0.width', values: zeros() },
        { param: 'ops.1.width', values: zeros() },
        { param: 'ops.2.width', values: zeros() },
      ],
    });
    expect(corrections).toEqual([
      `${PATH}.lanes[0]: "volume" is not a parameter a lane can modulate — lane dropped`,
      `${PATH}.lanes[1].values: 1 values for ${ARP_STEPS_MAX} steps — resized`,
      `${PATH}.lanes[5]: more than ${STEP_MOD_LANES_MAX} lanes — lane dropped`,
    ]);
    const lanes = spec.lanes as { param: string; values: number[] }[];
    expect(lanes.map((lane) => lane.param)).toEqual([
      'filter.cutoff',
      'filter.resonance',
      'ops.0.width',
      'ops.1.width',
    ]);
    expect(lanes[0]?.values).toEqual([0.5, ...zeros().slice(1)]);
  });

  it('clamps the accent and skip amounts to 0–1, reported', () => {
    const { spec, corrections } = arp({ accentVelocity: 2, accentMod: -1, skipChance: 'often' });
    expect(corrections).toEqual([
      `${PATH}.accentVelocity: clamped 2 to 1`,
      `${PATH}.accentMod: clamped -1 to 0`,
      `${PATH}.skipChance: "often" is not a number — using 0`,
    ]);
    expect(spec).toMatchObject({ accentVelocity: 1, accentMod: 0, skipChance: 0 });
  });
});

describe("a region's arp pattern carries the grid (windsor#127)", () => {
  const BAR = TICKS_PER_BAR;
  const ARP_PART = { kind: 'arp', ...DEFAULT_ARP_CONFIG, seed: 3 };

  it('round-trips a written grid and normalises a bad one with the same rules', () => {
    const steps = padded([arpNote({ accent: true }), { kind: 'rest' }]);
    const lanes = [{ param: 'filter.cutoff', values: zeros() }];
    // A pattern has no seed: the part's is the only one.
    const good: Record<string, unknown> = {
      kind: 'arp',
      ...DEFAULT_ARP_CONFIG,
      steps,
      lanes,
      accentMod: 0.5,
      skipChance: 0.1,
    };
    delete good.seed;
    const regions = [
      { start: 0, duration: BAR, pattern: good },
      { start: BAR, duration: BAR, pattern: { kind: 'arp', steps: [{ kind: 'tie' }] } },
    ];
    const result = makeArrangement(
      song([{ slot: 0, name: 'arp', preset: 'saw-arp', regions, sequencer: ARP_PART }]),
    );
    expect(result.corrections).toEqual([
      'parts[0].regions[1].pattern.steps: 1 steps for 32 — resized with plain notes',
    ]);
    expect(isShippable(result)).toBe(true);
    const [first, second] = result.document.parts[0]?.regions ?? [];
    expect(first?.pattern).toStrictEqual(good);
    expect(second?.pattern).toMatchObject({
      steps: padded([{ kind: 'tie' }]),
      lanes: [],
      accentVelocity: DEFAULT_ARP_CONFIG.accentVelocity,
      skipChance: 0,
    });
    const again = makeArrangement(JSON.parse(JSON.stringify(result.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(result.document);
  });
});
