/**
 * The version-3 document (#705): a version-2 file is refused with the reason,
 * the fields that moved are reported where they were, a part with no regions
 * is silent and says so, and the `arp` / `bass` kinds round-trip with their
 * full field sets before their performers exist.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { isShippable, makeArrangement } from './arrangementDocument';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { ARP_STEPS_MAX } from '../sequencing/arpStepConstants';
import { defaultArpSteps } from '../sequencing/arpSteps';
import { TICKS_PER_BAR } from '../sequencing/scheduler';
import { ALL, KICK, PATCHES, play, song } from '../__fixtures__/documentCases';

describe('the version-3 document (#705)', () => {
  it('refuses a version-2 document and says why', () => {
    const result = makeArrangement({
      version: 2,
      seed: 204,
      bpm: 96,
      key: { root: 50, scale: 'dorian' },
      patches: PATCHES,
      parts: [{ slot: 0, preset: 'kick', sequencer: { kind: 'euclidean' } }],
    });
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.corrections).toEqual([
      `version: 2 is not ${ARRANGEMENT_VERSION} — version 2 is not supported since #705`,
      'nothing usable survives normalisation — falling back to the metronome',
    ]);
  });

  it('reports seed, bpm and key at the top level as unknown keys (they moved)', () => {
    const result = makeArrangement(song([KICK], { seed: 1, bpm: 96, key: {} }));
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual([
      'seed: unknown key dropped',
      'bpm: unknown key dropped',
      'key: unknown key dropped',
    ]);
  });

  it('normalises a part with no regions to none, reported: the part is silent', () => {
    const result = makeArrangement(song([{ slot: 0, preset: 'kick', regions: undefined }]));
    expect(result.usable).toBe(true);
    expect(result.document.parts[0]?.regions).toEqual([]);
    expect(result.corrections).toEqual([
      'parts[0].regions: missing — the part has no regions and is silent',
    ]);
  });

  it('round-trips arp and bass parts with their full field sets, correction-free', () => {
    const arp = {
      kind: 'arp',
      style: 'upDown',
      divisor: 12,
      gate: 0.6,
      octaves: 2,
      voicing: 'spread',
      retrigger: true,
      register: { octave: 5 },
      steps: [{ kind: 'rest' }, ...defaultArpSteps(ARP_STEPS_MAX - 1)],
      lanes: [],
      accentVelocity: 0.3,
      accentMod: 0.9,
      skipChance: 0.1,
      seed: 31,
    };
    const bass = {
      kind: 'bass',
      pitchMode: 'followChord',
      rootBias: 0.4,
      fixedDegree: 2,
      divisor: 24,
      gate: 0.8,
      register: { octave: 1 },
      density: 0.7,
      seed: 32,
    };
    const regions = [{ start: 0, duration: 2 * TICKS_PER_BAR }];
    const written = song([
      { slot: 2, name: 'arp', preset: 'saw-arp', sequencer: arp },
      { slot: 3, name: 'bass', preset: 'drone-sqr', regions, sequencer: bass },
    ]);
    const result = makeArrangement(written);
    expect(result.corrections).toEqual([]);
    expect(isShippable(result)).toBe(true);
    expect(result.document.parts.map((part) => part.sequencer)).toEqual([arp, bass]);
    expect(result.document.parts.map((part) => part.regions)).toEqual([ALL, regions]);
    const again = makeArrangement(JSON.parse(JSON.stringify(result.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(result.document);
    expect(() => play(result.document)).not.toThrow();
  });
});
