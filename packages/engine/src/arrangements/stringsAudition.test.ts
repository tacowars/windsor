/**
 * The strings audition (#695 decision 10): it normalises cleanly; the Solina
 * strip carries the enabled ensemble on the Solina preset and the old
 * two-chorus chain switched off, so the A/B is the on switches; the Juno
 * strips carry Juno II and Juno I + II.
 */
import { describe, expect, it } from 'vitest';

import { makeArrangement } from '../song/arrangementDocument';
import { matchingChorusPreset } from '../inserts/chorusPresets';
import { matchingEnsemblePreset } from '../inserts/ensemblePresets';
import type { InsertSpec } from '../inserts/insertRegistry';
import raw from './strings-audition.json';

const result = makeArrangement(raw);
const inserts = (name: string): readonly InsertSpec[] =>
  result.document.parts.find((p) => p.name === name)?.strip?.inserts ?? [];

describe('strings-audition.json', () => {
  it('normalises with no correction and nothing dangling', () => {
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual([]);
    expect(result.dangling).toEqual([]);
  });

  it('runs the Solina through the ensemble, with the two-chorus chain beside it switched off', () => {
    const [ensemble, ...chain] = inserts('solina');
    expect(ensemble?.kind).toBe('ensemble');
    if (ensemble?.kind !== 'ensemble') return;
    expect(ensemble.enabled).toBe(true);
    expect(matchingEnsemblePreset(ensemble)).toBe('solina');
    expect(chain.map((i) => [i.kind, 'enabled' in i && i.enabled])).toEqual([
      ['chorus', false],
      ['chorus', false],
    ]);
  });

  it('plays the Juno strings through Juno II and a second Juno part through Juno I + II', () => {
    const presetOf = (name: string): (string | undefined)[] =>
      inserts(name).map((i) => (i.kind === 'chorus' ? matchingChorusPreset(i) : undefined));
    expect(presetOf('juno strings')).toEqual(['juno-2']);
    expect(presetOf('juno I+II')).toEqual(['juno-1-2']);
  });
});
