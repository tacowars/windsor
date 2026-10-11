/**
 * A host's slot in the song (record `2026-10-11-wet-path-slot`, windsor#687):
 * one child insert inside a host's spec, read by the registry, never by the
 * host's kind. Absent or null is none, silently; junk, the host's own kind
 * and an unknown kind are none, reported; a kept child has its own id, is
 * one level deep, and counts toward no limit.
 */
import { describe, expect, it } from 'vitest';

import { FULL_DOCUMENT, FULL_STRIPS, withDocumentPart } from '../__fixtures__/fullArrangement';
import { makeArrangement } from '../song/arrangementDocument';
import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_CHORUS } from './chorusInsert';
import { DEFAULT_COMPRESSOR } from './compressorInsert';
import { DEFAULT_DRIVE } from './driveInsert';
import { DEFAULT_ECHO } from './echoInsert';
import { MAX_INSERTS } from './insertConstants';
import { isInsertId } from './insertIds';
import type { InsertKind } from './insertKind';
import {
  INSERT_KINDS,
  insertSlot,
  isHostKind,
  normaliseInsertEntry,
  normaliseInserts,
  type InsertRegistry,
  type InsertSpec,
} from './insertRegistry';
import { DEFAULT_PHASER } from './phaserSpec';

const PATH = 'parts[1].strip.inserts';

/** One Echo holding `slot`, normalised: the spec, its child and the corrections. */
function echoHolding(slot: unknown, registry?: InsertRegistry) {
  const n = new FieldNormaliser();
  const [spec] = normaliseInserts([{ ...DEFAULT_ECHO, id: 'e1', slot }], PATH, n, registry);
  return { spec: spec!, child: insertSlot(spec!), corrections: n.corrections, n };
}

describe('host kinds', () => {
  it('is Echo alone, by the slot in its fields', () => {
    const hosts = Object.entries(INSERT_KINDS).filter(([, kind]) => isHostKind(kind));
    expect(hosts.map(([name]) => name)).toEqual(['echo']);
    expect(insertSlot(DEFAULT_DRIVE)).toBeNull();
  });
});

describe('a slot that holds nothing', () => {
  it('reads absent or null as none, silently, and an Echo without one as before', () => {
    for (const raw of [undefined, null]) {
      const { spec, child, corrections } = echoHolding(raw);
      expect(child).toBeNull();
      expect(spec).toEqual({ ...DEFAULT_ECHO, id: 'e1' });
      expect(corrections).toEqual([]);
    }
  });

  it('corrects junk to none', () => {
    for (const raw of [3, 'chorus', true, ['x']]) {
      const { child, corrections } = echoHolding(raw);
      expect(child).toBeNull();
      expect(corrections).toEqual([
        `${PATH}[0].slot: ${JSON.stringify(raw)} is not an insert — dropped`,
      ]);
    }
  });

  it('refuses an Echo inside an Echo', () => {
    const { child, corrections } = echoHolding({ ...DEFAULT_ECHO, id: 'inner' });
    expect(child).toBeNull();
    expect(corrections).toEqual([`${PATH}[0].slot: a echo cannot hold another echo — using none`]);
  });

  it('drops an unknown kind as dangling', () => {
    const { child, n } = echoHolding({ kind: 'fuzz', id: 'f' });
    expect(child).toBeNull();
    expect(n.dangling).toEqual([`${PATH}[0].slot.kind: no insert kind "fuzz" is defined`]);
    expect(n.corrections).toEqual([`${PATH}[0].slot: dropped`]);
  });
});

describe('a child in the slot', () => {
  const PHASER = { ...DEFAULT_PHASER, rate: 2, mix: 0.4, id: 'ph1' };

  it("keeps the child's fields and id, and its own Mix", () => {
    const { child, corrections } = echoHolding(PHASER);
    expect(child).toEqual(PHASER);
    expect(corrections).toEqual([]);
  });

  it("clamps the child's fields at its own path", () => {
    const { child, corrections } = echoHolding({ ...PHASER, mix: 2 });
    expect(child).toEqual({ ...PHASER, mix: 1 });
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.startsWith(`${PATH}[0].slot.mix:`)).toBe(true);
  });

  it('fills a missing id silently, replaces an invalid one, and keeps one equal to its host', () => {
    const bare = { ...PHASER, id: undefined };
    const filled = echoHolding(bare);
    expect(isInsertId(filled.child?.id)).toBe(true);
    expect(filled.corrections).toEqual([]);
    expect(echoHolding(bare).child?.id).toBe(filled.child?.id);

    const invalid = echoHolding({ ...PHASER, id: 7 });
    expect(isInsertId(invalid.child?.id)).toBe(true);
    expect(invalid.corrections).toEqual([`${PATH}[0].slot.id: 7 is not an id — a new one`]);

    const same = echoHolding({ ...PHASER, id: 'e1' });
    expect(same.child?.id).toBe('e1');
    expect(same.spec.id).toBe('e1');
    expect(same.corrections).toEqual([]);
  });

  it('forces a child compressor to listen to its own input', () => {
    const external = { ...DEFAULT_COMPRESSOR, sidechain: { track: 2 }, id: 'c1' };
    const { child, corrections } = echoHolding(external);
    expect(child).toEqual({ ...external, sidechain: 'internal' });
    expect(corrections).toEqual([
      `${PATH}[0].slot.sidechain: {"track":2} in a slot — set to "internal"`,
    ]);
    expect(echoHolding({ ...DEFAULT_COMPRESSOR, id: 'c1' }).corrections).toEqual([]);
  });

  it("empties a host child's own slot, one level deep", () => {
    // A second host kind, injected, since Echo is the only one that ships.
    const bloom: InsertKind<InsertSpec> = {
      fields: ['kind', 'slot'],
      defaults: { kind: 'bloom', slot: null } as unknown as InsertSpec,
      normalise: () => ({ kind: 'bloom', slot: null }) as unknown as InsertSpec,
      create: () => {
        throw new Error('not built in this test');
      },
    };
    const registry: InsertRegistry = { ...INSERT_KINDS, bloom };
    const nested = { kind: 'bloom', id: 'b1', slot: { ...DEFAULT_CHORUS, id: 'c' } };
    const { child, corrections } = echoHolding(nested, registry);
    expect(child).toEqual({ kind: 'bloom', slot: null, id: 'b1' });
    expect(corrections).toEqual([
      `${PATH}[0].slot.slot: an insert in a slot holds no slot of its own — using none`,
    ]);
    expect(echoHolding({ kind: 'bloom', id: 'b1', slot: null }, registry).corrections).toEqual([]);
  });

  it(`does not count toward the ${MAX_INSERTS}-insert limit`, () => {
    const raw = [
      { ...DEFAULT_ECHO, slot: PHASER },
      ...Array.from({ length: MAX_INSERTS - 1 }, () => DEFAULT_DRIVE),
    ];
    const n = new FieldNormaliser();
    const list = normaliseInserts(raw, PATH, n);
    expect(list).toHaveLength(MAX_INSERTS);
    expect(insertSlot(list[0]!)).toEqual(PHASER);
    expect(n.corrections).toEqual([]);
  });

  it('reads one entry on its own, its id apart', () => {
    const n = new FieldNormaliser();
    const spec = normaliseInsertEntry({ ...DEFAULT_ECHO, id: 'e1', slot: PHASER }, 'x', n);
    expect(spec).toEqual({ ...DEFAULT_ECHO, slot: PHASER });
    expect(normaliseInsertEntry(3, 'x', n)).toBeUndefined();
  });

  it('round-trips through a song document', () => {
    const echo = { ...DEFAULT_ECHO, id: 'e1', slot: PHASER };
    const song = withDocumentPart(FULL_DOCUMENT, 'hat', {
      strip: { ...FULL_STRIPS.hat, inserts: [echo] },
    });
    const first = makeArrangement(song);
    expect(first.corrections).toEqual([]);
    const hat = first.document.parts.find((part) => part.name === FULL_DOCUMENT.parts[1]!.name);
    expect(hat?.strip?.inserts).toEqual([echo]);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
