/**
 * The Arp card's seed rules (#706): Reseed writes a new safe integer into the
 * document, and the Seed field accepts only what the normaliser keeps.
 */
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ARP_CONFIG,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
  partAt,
} from '../../../packages/client/src/audio/index-for-editor';
import { arpSeedChange, freshSeed, parseSeed } from './arpModel';
import { DocumentModel } from './documentModel';
import { octaveKnob } from './harmonyTables';
import { ARP_KNOBS, ARP_RESEED_SPAN } from './sequencerKnobTables';

const arpSong = (): DocumentModel =>
  new DocumentModel({
    version: 3,
    parts: [
      {
        slot: 0,
        name: 'Arp',
        preset: 'saw-arp',
        sequencer: { kind: 'arp', ...DEFAULT_ARP_CONFIG },
      },
    ],
  });
const seedOf = (model: DocumentModel): unknown => {
  const sequencer = partAt(model.doc, 0)?.sequencer;
  return sequencer?.kind === 'arp' ? sequencer.seed : undefined;
};

describe('Reseed', () => {
  it('writes a new safe-integer seed into the document, and it survives a reopen', () => {
    const model = arpSong();
    const before = seedOf(model);
    const seed = freshSeed(Number(before), () => 0.25);
    model.merge(arpSeedChange(0, seed));
    expect(seedOf(model)).toBe(seed);
    expect(seed).not.toBe(before);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(seedOf(new DocumentModel(JSON.parse(model.toJson())))).toBe(seed);
  });

  it('never draws the current seed, and stays inside the span', () => {
    const draw = (): number => 0;
    expect(freshSeed(0, draw)).toBe(1);
    expect(freshSeed(5, draw)).toBe(0);
    expect(freshSeed(ARP_RESEED_SPAN - 1, () => 1 - Number.EPSILON)).toBe(0);
  });
});

describe('the Seed field', () => {
  it('takes a safe integer', () => {
    expect(parseSeed(' 42 ')).toBe(42);
    expect(parseSeed('-7')).toBe(-7);
  });

  it('refuses anything else', () => {
    for (const text of ['', '4.5', 'abc', '1e3', String(2 ** 60)]) {
      expect(parseSeed(text), text).toBeNull();
    }
  });
});

describe("the card's knobs", () => {
  it('default to what the normaliser writes for a bare arp part', () => {
    const bare = new DocumentModel({
      version: 3,
      parts: [{ slot: 0, name: 'Arp', preset: 'saw-arp', sequencer: { kind: 'arp' } }],
    });
    const part = partAt(bare.doc, 0)!;
    const sequencer = part.sequencer;
    if (sequencer.kind !== 'arp') throw new Error('not an arp');
    for (const entry of ARP_KNOBS) {
      const engine = entry.kind === 'section' ? part[entry.f] : Reflect.get(sequencer, entry.f);
      expect(entry.o.def, entry.f).toBe(engine);
    }
    expect(octaveKnob('arp').def).toBe(sequencer.register.octave);
    expect([octaveKnob('arp').min, octaveKnob('arp').max]).toEqual([
      REGISTER_OCTAVE_MIN,
      REGISTER_OCTAVE_MAX,
    ]);
  });
});
