/**
 * Sequencer lanes through the player (windsor#488): a `seq.` lane's value is
 * read by the part's region gate on the tick it issues and handed to the
 * generator's onset. A falling skip lane on a Grid draws the unlaned stream,
 * a gate lane on an Arp sets each note's length from its onset, a lane
 * turned off or deleted hands the config back on the next tick, a lane flat
 * at the config's value plays exactly what no lane plays, and a kind change
 * drops the lanes the new kind does not offer, live as in the document.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds, type RecordingPart } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { valueAt } from '../automation/automationEvaluate';
import type { AutomationLane, AutomationPoint, SeqTargetId } from '../automation/automationLane';
import { partOwner } from '../automation/automationOwner';
import { requireCatalogRow } from '../automation/automationTargets';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_BASS_CONFIG } from '../sequencing/bassSequencer';
import { DEFAULT_FIGURE_CONFIG } from '../sequencing/figureSequencer';
import { streamRng } from '../sequencing/generatorSeed';
import { gridNote } from '../sequencing/gridSequencer';
import { DEFAULT_CHORD_CONFIG } from '../sequencing/chordSequencer';
import { DIVISORS, PPQ, TICKS_PER_BAR, type Scheduler } from '../sequencing/scheduler';
import type { PartStrip } from '../mixer/channelStrip';
import { SongAutomation } from '../system/songAutomation';
import type { Arrangement, MusicPart, SequencerSpec } from './arrangement';
import type { ArrangementDocument, DocumentPartial } from './arrangementDocument';

const BAR = TICKS_PER_BAR;
const EIGHTH = DIVISORS.eighth;
const QUARTER = DIVISORS.quarter;

const point = (tick: number, value: number): AutomationPoint => ({ tick, value, bend: 0 });
const lane = (target: SeqTargetId, points: AutomationPoint[], on = true): AutomationLane => ({
  target,
  on,
  points,
});

/** The fixture with its `arp` slot playing `sequencer` and `lanes` over `bars` bars, live throughout. */
function song(sequencer: SequencerSpec, lanes: AutomationLane[], bars = 4): Arrangement {
  const change = {
    regions: [{ start: 0, duration: bars * BAR }],
    sequencer,
    automation: lanes,
  } as Partial<MusicPart>;
  return withPart({ ...FULL_ARRANGEMENT, transport: { bpm: 96, bars } }, 'arp', change);
}

const tickOf = (time: number): number => Math.round((time * 96 * PPQ) / SECONDS_PER_MINUTE);
const onTicks = (part: RecordingPart): number[] =>
  kinds(part, 'noteOn').map((c) => tickOf(c.time!));
/** Each note's length in ticks: a gated part's ons and offs alternate. */
const lengths = (part: RecordingPart): number[] => {
  const offs = kinds(part, 'noteOffByNote').map((c) => tickOf(c.time!));
  return onTicks(part).map((on, i) => offs[i]! - on);
};
const perBar = (ticks: number[], bars: number): number[] =>
  Array.from({ length: bars }, (_, bar) => ticks.filter((t) => Math.floor(t / BAR) === bar).length);

describe('sequencer lanes in the player', () => {
  it('plays a falling skip lane on a Grid from the unlaned stream: silent, rising, then whole', () => {
    const bars = 12;
    const points = [point(0, 1), point(BAR, 1), point(8 * BAR, 0)];
    const grid: SequencerSpec = {
      kind: 'grid',
      seed: 7,
      divisor: EIGHTH,
      steps: Array.from({ length: 8 }, (_, i) => gridNote(i % 5)),
      length: 8,
      skipChance: 0,
      accentVelocity: 0,
      accentMod: 0,
      register: { octave: 4 },
      lanes: [],
    };
    const r = rig(song(grid, [lane('seq.skipChance', points)], bars));
    r.run(bars);
    // The stream the unlaned Grid draws, one draw per note step while the chance is above 0.
    const row = requireCatalogRow('seq.skipChance');
    const rng = streamRng(7, 0);
    const expected: number[] = [];
    for (let tick = 0; tick < bars * BAR; tick += EIGHTH) {
      const chance = valueAt(row, points, tick);
      if (!(chance > 0 && rng() < chance)) expected.push(tick);
    }
    const heard = onTicks(r.parts.arp);
    expect(heard).toEqual(expected);
    const counts = perBar(heard, bars);
    expect(counts[0]).toBe(0);
    expect(counts.slice(8)).toEqual([8, 8, 8, 8]);
    for (let bar = 1; bar < 8; bar++) expect(counts[bar]).toBeGreaterThanOrEqual(counts[bar - 1]!);
  });

  it('sets each Arp note from the gate on the tick it starts; a note sounding keeps its own', () => {
    const arp: SequencerSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, divisor: QUARTER, gate: 0.5 };
    // 0.75 at the first onset, stepping to 0.25 halfway through that note.
    const gate = lane('seq.gate', [point(0, 0.75), point(12, 0.75), point(12, 0.25)]);
    const r = rig(song(arp, [gate], 1));
    r.run(1);
    expect(lengths(r.parts.arp)).toEqual([18, 6, 6, 6]);
  });

  it('hands the config back on the next tick when a lane is turned off or deleted', () => {
    const bass: SequencerSpec = { kind: 'bass', ...DEFAULT_BASS_CONFIG, density: 1 };
    const silent = lane('seq.density', [point(0, 0)]);
    const r = rig(song(bass, [silent]));
    const slot = r.player.arrangement.parts.find((p) => p.sequencer.kind === 'bass')!.slot;
    r.run(1);
    r.player.setLanes(slot, [{ ...silent, on: false }]);
    r.run(1);
    r.player.setLanes(slot, [silent]);
    r.run(1);
    r.player.setLanes(slot, []);
    r.run(1);
    expect(perBar(onTicks(r.parts.arp), 4)).toEqual([0, 8, 0, 8]);
  });

  it('plays exactly what no lane plays with every lane flat at the config value', () => {
    const flat = (field: 'gate' | 'skipChance' | 'density', value: number): AutomationLane =>
      lane(`seq.${field}`, [point(0, value)]);
    const cases: Array<[SequencerSpec, AutomationLane[]]> = [
      [FULL_ARRANGEMENT.parts[2]!.sequencer, [flat('skipChance', 0.3)]],
      [
        { kind: 'arp', ...DEFAULT_ARP_CONFIG, skipChance: 0.4 },
        [flat('gate', 0.5), flat('skipChance', 0.4)],
      ],
      [
        { kind: 'bass', ...DEFAULT_BASS_CONFIG, density: 0.6 },
        [flat('gate', 0.8), flat('density', 0.6)],
      ],
      [
        { kind: 'figure', ...DEFAULT_FIGURE_CONFIG, skipChance: 0.2 },
        [flat('gate', 0.5), flat('skipChance', 0.2)],
      ],
    ];
    for (const [sequencer, lanes] of cases) {
      const bare = rig(song(sequencer, []));
      const laned = rig(song(sequencer, lanes));
      bare.run(4);
      laned.run(4);
      expect(bare.parts.arp.calls.length).toBeGreaterThan(0);
      expect(laned.parts.arp.calls).toEqual(bare.parts.arp.calls);
    }
  });

  it('drops a lane live on a kind change that does not offer it: Grid to Chord to Figure', () => {
    const grid = FULL_ARRANGEMENT.parts[2]!.sequencer;
    expect(grid.kind).toBe('grid');
    const r = rig(song(grid, [lane('seq.skipChance', [point(0, 1)])], 2));
    const document = r.player.arrangement as unknown as ArrangementDocument;
    const slot = document.parts.find((p) => p.sequencer.kind === 'grid')!.slot;
    const strip = { nextInsertSpecs: [] } as unknown as PartStrip;
    const scheduler = { transport: r.transport } as Scheduler;
    const live = new SongAutomation(scheduler, { currentTime: 0 }, () => strip);
    live.begin(document);
    live.load(document);
    const change = (sequencer: SequencerSpec): void => {
      const partial = { parts: { [slot]: { sequencer } } } as unknown as DocumentPartial;
      expect(r.player.apply(partial as never).ok).toBe(true);
      live.apply(partial, () => r.player.arrangement, r.player);
    };
    r.run(1);
    change({ kind: 'chord', ...DEFAULT_CHORD_CONFIG });
    change({ kind: 'figure', ...DEFAULT_FIGURE_CONFIG });
    expect(onTicks(r.parts.arp)).toEqual([]);
    expect(live.lanesOf(partOwner(slot))).toEqual([]);
    r.run(1);
    expect(onTicks(r.parts.arp).length).toBeGreaterThan(0);
  });
});
