/** Bounce to Roll's toasts (windsor#742, record `2026-10-11-bounce-to-roll` decisions 6 and 8). */
import { describe, expect, it } from 'vitest';

import type { BounceSummary } from '@windsor/engine';
import { bounceToRoll } from '@windsor/engine';
import { BOUNCE_SLOT, gridSpec } from '@windsor/engine/__fixtures__/bounceRig';
import { ACID_SAW, bounceDocument } from '@windsor/engine/__fixtures__/bounceToRollRig';
import { bounceRefusalText, bounceSuccessText } from './bounceToastModel';

const NOTHING_LOST: BounceSummary = {
  notes: 24,
  regions: 2,
  ticksRounded: 0,
  ratchetHitsLost: 0,
  accentsLostMod: 0,
  repeatsTrimmed: 0,
  euclidTailsCut: 0,
  silenced: 0,
  lanesBaked: [],
  velocity: 1,
  followers: [],
};

describe('the success toast', () => {
  it('reads the Acid Saw bounce as the engine sums it', () => {
    const doc = bounceDocument(gridSpec(ACID_SAW, { accentVelocity: 0.2, accentMod: 1 }), {
      preset: 'acid-saw',
    });
    const result = bounceToRoll(doc, BOUNCE_SLOT);
    expect(result.ok && bounceSuccessText(result.summary)).toBe(
      'Bounced to Roll: 12 notes in 1 region · 4 accents lost their mod',
    );
  });

  it('leaves out every zero count', () => {
    expect(bounceSuccessText(NOTHING_LOST)).toBe('Bounced to Roll: 24 notes in 2 regions');
  });

  it("says every count in decision 8's order, plural, then the lanes and each canon", () => {
    const summary: BounceSummary = {
      ...NOTHING_LOST,
      notes: 214,
      regions: 3,
      ticksRounded: 12,
      ratchetHitsLost: 2,
      accentsLostMod: 6,
      repeatsTrimmed: 4,
      euclidTailsCut: 3,
      silenced: 5,
      lanesBaked: ['gate', 'skipChance'],
      followers: [{ slot: 3, name: 'Pad' }],
    };
    expect(bounceSuccessText(summary)).toBe(
      'Bounced to Roll: 214 notes in 3 regions · 12 ticks rounded · 2 ratchet hits lost · ' +
        "6 accents lost their mod · 4 repeats trimmed · 3 Euclid tails cut at a region's end · " +
        '5 notes at velocity 0 silenced · Skip and Gate lanes baked · ' +
        "Pad's canon lost its leader",
    );
  });

  it('says each count of 1 in the singular', () => {
    const summary: BounceSummary = {
      ...NOTHING_LOST,
      notes: 1,
      regions: 1,
      ticksRounded: 1,
      ratchetHitsLost: 1,
      accentsLostMod: 1,
      repeatsTrimmed: 1,
      euclidTailsCut: 1,
      silenced: 1,
      lanesBaked: ['density'],
    };
    expect(bounceSuccessText(summary)).toBe(
      'Bounced to Roll: 1 note in 1 region · 1 tick rounded · 1 ratchet hit lost · ' +
        "1 accent lost its mod · 1 repeat trimmed · 1 Euclid tail cut at a region's end · " +
        '1 note at velocity 0 silenced · Density lane baked',
    );
  });

  it('names three lanes in a list, and a canon line per follower', () => {
    const summary: BounceSummary = {
      ...NOTHING_LOST,
      notes: 0,
      lanesBaked: ['density', 'gate', 'skipChance'],
      followers: [
        { slot: 2, name: 'Pad' },
        { slot: 4, name: 'Bell' },
      ],
    };
    expect(bounceSuccessText(summary)).toBe(
      'Bounced to Roll: 0 notes in 2 regions · Skip, Gate and Density lanes baked · ' +
        "Pad's canon lost its leader · Bell's canon lost its leader",
    );
  });
});

describe('the refusal toast', () => {
  it('names the region, the notes it needs and the cap', () => {
    expect(bounceRefusalText({ cap: 'notes', region: 3, notes: 3104 })).toBe(
      'Region 3 needs 3104 notes; a Roll region holds 2048. Split it first.',
    );
  });

  it('names the region, the loop it needs and the cap in bars of 4/4', () => {
    expect(bounceRefusalText({ cap: 'loop', region: 1, ticks: 36000, bars: 300 })).toBe(
      'Region 1 needs a 300-bar loop; a Roll loops at most 256 bars of 4/4. Split it first.',
    );
  });
});
