/**
 * Bounce to Roll (windsor#741, `docs/log/2026-10-11-bounce-to-roll.md`
 * decisions 2, 4, 5 and 8): the record's worked examples bounced whole,
 * the empty regions, the sequencer lanes, the ∞ region and the canon's
 * follower, each result applied and normalised with nothing to trim and
 * round-tripped through an export unchanged.
 */
import { describe, expect, it } from 'vitest';

import { BOUNCE_SLOT, gridNote, gridSpec, REST } from '../__fixtures__/bounceRig';
import { ACID_SAW, applyBounce, bounceDocument } from '../__fixtures__/bounceToRollRig';
import type { AutomationLane } from '../automation/automationLane';
import type { FigureSpec, MusicPart, RollSpec } from './arrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { makeArrangement } from './arrangementDocument';
import { bounceToRoll } from './bounceToRoll';
import type { BounceResult } from './bounceToRollTypes';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { DEFAULT_FIGURE_CONFIG } from '../sequencing/figureSequencer';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

/** The bounce applied, checked clean, and the bounced part as the song then holds it. */
function bounced(doc: ArrangementDocument, result: BounceResult): MusicPart {
  const { normalised } = applyBounce(doc, result);
  expect(normalised.corrections).toEqual([]);
  const exported = JSON.stringify(normalised.document);
  const imported = makeArrangement(JSON.parse(exported));
  expect(imported.corrections).toEqual([]);
  expect(JSON.stringify(imported.document)).toBe(exported);
  return normalised.document.parts.find((part) => part.slot === BOUNCE_SLOT)!;
}

const rollOf = (part: MusicPart, region = 0): RollSpec => part.regions[region]!.pattern as RollSpec;

const acidDocument = (steps = ACID_SAW) =>
  bounceDocument(gridSpec(steps, { accentVelocity: 0.2, accentMod: 1 }), { preset: 'acid-saw' });

describe('the record’s worked examples', () => {
  it('bounces the Acid Saw 4-bar region to a 1-bar loop of 12 notes, its Vel at 1.0, 4 accents losing their mod', () => {
    const doc = acidDocument();
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const part = bounced(doc, result);
    expect(part.velocity).toBe(1);
    expect(part.sequencer).toEqual({ kind: 'roll', loopTicks: TICKS_PER_BAR, notes: [] });
    const roll = rollOf(part);
    expect(roll.loopTicks).toBe(TICKS_PER_BAR);
    expect(roll.notes).toHaveLength(12);
    // The eight plain notes keep the part's 0.8; the four accents play 1, written as no key.
    expect(roll.notes.slice(0, 3)).toEqual([
      { tick: 0, ticks: 6, pitch: 33 },
      { tick: 6, ticks: 7, pitch: 33, velocity: 0.8 },
      { tick: 12, ticks: 12, pitch: 45, velocity: 0.8 },
    ]);
    expect(roll.notes.filter((note) => note.velocity === undefined)).toHaveLength(4);
    expect(result.ok && result.summary).toMatchObject({
      notes: 12,
      regions: 1,
      accentsLostMod: 4,
      ticksRounded: 0,
      ratchetHitsLost: 0,
      repeatsTrimmed: 0,
      euclidTailsCut: 0,
      silenced: 0,
      lanesBaked: [],
      velocity: 1,
      followers: [],
    });
  });

  it('unrolls the same line with a slide on step 1 to 4 bars of 48 notes', () => {
    const doc = acidDocument([gridNote(0, { accent: true, slide: true }), ...ACID_SAW.slice(1)]);
    const roll = rollOf(bounced(doc, bounceToRoll(doc, BOUNCE_SLOT)));
    expect(roll.loopTicks).toBe(4 * TICKS_PER_BAR);
    expect(roll.notes).toHaveLength(48);
  });

  it('unrolls the Arp’s skip take to a 4-bar loop of its 49 notes', () => {
    const doc = bounceDocument({ kind: 'arp', ...DEFAULT_ARP_CONFIG, skipChance: 0.25, seed: 0 });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const roll = rollOf(bounced(doc, result));
    expect(roll.loopTicks).toBe(4 * TICKS_PER_BAR);
    expect(roll.notes).toHaveLength(49);
    expect(result.ok && result.summary.notes).toBe(49);
  });
});

describe('empty regions', () => {
  const rests = gridSpec([REST, REST, REST, REST]);

  it('gives an all-rest region an empty roll looping the region’s length', () => {
    const doc = bounceDocument(gridSpec([gridNote(0), REST, REST, REST]), {
      regions: [
        { start: 0, duration: 2 * TICKS_PER_BAR, pattern: rests },
        { start: 4 * TICKS_PER_BAR, duration: TICKS_PER_BAR },
      ],
    });
    const part = bounced(doc, bounceToRoll(doc, BOUNCE_SLOT));
    expect(rollOf(part, 0)).toEqual({ kind: 'roll', loopTicks: 2 * TICKS_PER_BAR, notes: [] });
    expect(rollOf(part, 1).notes).toHaveLength(4);
  });

  it('bounces a part whose every region is empty with 0 notes, counting its regions', () => {
    const doc = bounceDocument(rests, {
      regions: [
        { start: 0, duration: TICKS_PER_BAR },
        { start: 2 * TICKS_PER_BAR, duration: 3 * TICKS_PER_BAR },
      ],
    });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const part = bounced(doc, result);
    expect(part.regions.map((region) => (region.pattern as RollSpec).loopTicks)).toEqual([
      TICKS_PER_BAR,
      3 * TICKS_PER_BAR,
    ]);
    expect(result.ok && result.summary).toMatchObject({ notes: 0, regions: 2 });
  });
});

describe('the part’s lanes', () => {
  const skip: AutomationLane = {
    target: 'seq.skipChance',
    on: true,
    points: [{ tick: 0, value: 0.5, bend: 0 }],
  };
  const volume: AutomationLane = {
    target: 'strip.level',
    on: true,
    points: [{ tick: 0, value: 0.5, bend: 0 }],
  };

  it('removes the Skip lane, names it baked, and leaves the Volume lane as it was', () => {
    const grid = gridSpec([gridNote(0), gridNote(2), gridNote(4), gridNote(2)], { seed: 4 });
    const doc = bounceDocument(grid, { automation: [skip, volume] });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    const part = bounced(doc, result) as MusicPart & { automation?: readonly AutomationLane[] };
    expect(part.automation).toEqual([volume]);
    expect(result.ok && result.summary.lanesBaked).toEqual(['skipChance']);
  });
});

describe('the regions’ windows and the canon', () => {
  it('keeps a single ∞ region a whole-song region, rendered over one pass of the song', () => {
    const songTicks = 8 * TICKS_PER_BAR;
    const doc = bounceDocument(gridSpec([gridNote(0), REST]), {
      regions: [{ start: 0, duration: songTicks }],
    });
    const part = bounced(doc, bounceToRoll(doc, BOUNCE_SLOT));
    expect(part.regions).toHaveLength(1);
    expect(part.regions[0]).toMatchObject({ start: 0, duration: songTicks });
    expect(rollOf(part).loopTicks).toBe(TICKS_PER_BAR);
  });

  it('names the Figure part whose canon followed the bounced one', () => {
    const leader: FigureSpec = { kind: 'figure', ...DEFAULT_FIGURE_CONFIG };
    const follower = {
      slot: 1,
      name: 'Pad',
      preset: 'saw-arp',
      velocity: 0.8,
      regions: [{ start: 0, duration: 4 * TICKS_PER_BAR }],
      sequencer: { ...leader, source: { slot: BOUNCE_SLOT, offset: 2, transpose: 12 } },
    };
    const doc = bounceDocument(leader, { others: [follower] });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    expect(result.ok && result.summary.followers).toEqual([{ slot: 1, name: 'Pad' }]);
    // The normaliser, not the bounce, drops the follower's source, as at any kind change.
    const { corrections } = applyBounce(doc, result).normalised;
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatch(/parts\[1\]\.sequencer/);
  });
});
