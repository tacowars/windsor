/**
 * The admission order of a roll's clip envelopes to the part's voice slots
 * (windsor#725): the rule `ClipEnvelopeTracks.admit` runs and the app's env
 * ring reads. `clipEnvelopePlayer.test.ts` pins the tracks playing it.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RollEnvelope } from '../sequencing/rollEnvelope';
import { admittedEnvelopes, type EnvelopeAdmissionQuery } from './clipEnvelopeAdmission';

const LOOP = 96;

const env = (target: string, on = true, tick = 0): RollEnvelope =>
  ({ target, on, points: [{ tick, value: 1, bend: 0 }] }) as RollEnvelope;

const query = (at: Partial<EnvelopeAdmissionQuery>): EnvelopeAdmissionQuery => ({
  lanes: [],
  held: [],
  envelopes: [],
  loopTicks: LOOP,
  slots: 2,
  sounds: () => true,
  ...at,
});

describe('admittedEnvelopes', () => {
  it('admits in the roll’s order while a slot is free, an envelope on a lane’s target sharing its slot', () => {
    const envelopes = [
      env('filter.cutoff'),
      env('filter.resonance', false),
      env('lfo.amount', true, LOOP),
      env('ops.0.level'),
      env('filter.envAmount'),
      env('lfo2.amount'),
    ];
    const lanes = [{ target: 'voice.ops.0.level' }, { target: 'strip.level' }];
    // One slot is the lane's; Cutoff takes the other; the lane's target shares its own.
    expect(admittedEnvelopes(query({ envelopes, lanes }))).toEqual([
      'filter.cutoff',
      'ops.0.level',
    ]);
    // A target already held keeps its slot, and counts against the others.
    expect(
      admittedEnvelopes(query({ envelopes, lanes: [], held: [{ path: 'lfo2.amount' }] })),
    ).toEqual(['filter.cutoff', 'lfo2.amount']);
  });

  it('asks whether a target sounds only once a slot is there, and skips one that does not', () => {
    const sounds = vi.fn((path: string) => path !== 'filter.cutoff');
    const envelopes = [env('filter.cutoff'), env('filter.envAmount'), env('lfo2.amount')];
    const out = ['stale'];
    expect(admittedEnvelopes(query({ envelopes, slots: 1, sounds }), out)).toBe(out);
    expect(out).toEqual(['filter.envAmount']);
    expect(sounds.mock.calls.map(([path]) => path)).toEqual(['filter.cutoff', 'filter.envAmount']);
  });
});
