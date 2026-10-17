/**
 * The pure rack rules (windsor#868, record `2026-10-17-racks` decisions 2,
 * 3 and 10) over the full fixture: a rack built from the kick, and a rack
 * loaded into another part as one partial. The part added from a rack and
 * the modified dot's difference are `rackActionsPart.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type { Patch, RackFile } from '@windsor/engine';
import {
  clonePatch,
  formatTargetId,
  loadRackFile,
  partAt,
  seqTargetId,
  serialiseRackFile,
} from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import type { RackRef } from './rackActions';
import { loadRackChange, rackFromPart, withoutSeed } from './rackActions';
import { ALL, BARE, partFields, rackTestScope, raw } from './__fixtures__/rackScope';
import { loadBuiltIns } from './builtInLibrary';
import { setSequencerKind } from './songParts';

beforeAll(() => loadBuiltIns());

const { kick, hat, arp, drone, song, scope, chain } = rackTestScope(FULL_DOCUMENT, FULL_SLOT);

describe('rackFromPart (decision 2)', () => {
  it('takes the patch under the rack name, the chain with its keys cleared, the low cut and the pattern', () => {
    const model = song();
    const { ids } = scope(model);
    const file = rackFromPart(model.doc, kick, ALL, ids) as RackFile;
    expect(file.name).toBe('Kick Rack');
    expect(file.patch.name).toBe('Kick Rack');
    expect(file.patch.ops).toEqual(FULL_DOCUMENT.patches['kick']?.ops);
    expect(file.patchSource).toBe('kick');
    expect(file.lowCut).toBe(80);
    expect(file.sequencer).toEqual(withoutSeed(partAt(model.doc, kick)!.sequencer));
    const [drive, comp, echo] = file.inserts as unknown as Array<Record<string, unknown>>;
    expect(drive).toEqual(partAt(model.doc, kick)!.strip.inserts[0]);
    expect(comp!['sidechain']).toEqual({ track: null });
    expect((echo!['slot'] as Record<string, unknown>)['sidechain']).toBe('internal');
    // The song's own compressor still keys from the hat: the rack is a copy.
    expect((partAt(model.doc, kick)!.strip.inserts[1] as { sidechain: unknown }).sidechain).toEqual(
      {
        track: hat,
      },
    );
  });

  it('loads back through the rack loader with nothing to report', () => {
    const model = song();
    const { rack } = scope(model);
    const entry = loadRackFile('kick-rack', JSON.parse(serialiseRackFile(rack().file)));
    expect(entry.problems).toEqual([]);
    expect(entry.inserts).toEqual(rack().file.inserts);
  });

  it('leaves the low cut and the sequencer out unless asked', () => {
    const model = song();
    const { ids } = scope(model);
    const file = rackFromPart(model.doc, kick, BARE, ids) as RackFile;
    expect('lowCut' in file || 'sequencer' in file).toBe(false);
  });

  it("takes the part's own patchSource, else its preset when that is a library id, else none", () => {
    const model = song();
    const { ids } = scope(model);
    model.merge(
      raw({
        parts: { [hat]: { preset: 'hat-2', patchSource: 'hat' }, [arp]: { preset: 'mine' } },
        patches: {
          'hat-2': clonePatch(FULL_DOCUMENT.patches['hat'] as Patch),
          mine: { name: 'Mine' },
        },
      }),
    );
    expect(rackFromPart(model.doc, hat, BARE, ids)?.patchSource).toBe('hat');
    expect('patchSource' in (rackFromPart(model.doc, arp, BARE, ids) as RackFile)).toBe(false);
    // A song keeps any non-empty link, but the file takes a slug: one that is none is left out.
    model.merge(raw({ parts: { [hat]: { patchSource: 'custom patch' } } }));
    const file = rackFromPart(model.doc, hat, BARE, ids) as RackFile;
    expect('patchSource' in file).toBe(false);
    expect(loadRackFile('hat-rack', JSON.parse(serialiseRackFile(file))).problems).toEqual([]);
  });

  it('is null for an empty slot', () => {
    const model = song();
    expect(rackFromPart(model.doc, 9, BARE, new Set())).toBeNull();
  });
});

describe('loadRackChange (decision 10)', () => {
  it('sets the patch under the rack id, the links, the chain with its ids, the low cut and the pattern', () => {
    const model = song();
    const { rack, load } = scope(model);
    const ref = rack();
    const partial = load(arp, ref);
    const fields = partFields(partial, arp);
    expect(fields['preset']).toBe('kick-rack');
    expect(fields['rackSource']).toBe('kick-rack');
    expect(fields['patchSource']).toBe('kick');
    expect(fields['strip']).toEqual({ inserts: ref.file.inserts, lowCut: 80 });
    expect(fields['sequencer']).toEqual({ ...ref.file.sequencer, seed: 0 });
    expect('regions' in fields).toBe(false);
    const part = partAt(model.doc, arp)!;
    expect(part.preset).toBe('kick-rack');
    expect(part.strip.inserts.map((spec) => spec.id)).toEqual(['d1', 'c1', 'e1']);
    expect(part.sequencer.kind).toBe('euclidean');
    expect(model.doc.patches?.['kick-rack']).toEqual(ref.file.patch);
    expect(model.doc.patches?.['kick-rack']).not.toBe(ref.file.patch);
    // The patch the part left is no automatic copy, so it stays in the song.
    expect(model.doc.patches?.['saw-arp']).toBeDefined();
  });

  it('takes the next free id when the song already holds the rack id', () => {
    const model = song();
    const { rack, load } = scope(model);
    model.merge(raw({ patches: { 'kick-rack': { name: 'Taken' } } }));
    const partial = load(arp, rack());
    expect(partFields(partial, arp)['preset']).toBe('kick-rack-2');
    expect(model.doc.patches?.['kick-rack']?.name).toBe('Taken');
  });

  it('drops the lanes and mappings on inserts the rack lacks and keeps the rest', () => {
    const model = song();
    const { rack, load } = scope(model);
    const gone = formatTargetId({ kind: 'insert', insertId: 'zz', field: 'mix' });
    const kept = formatTargetId({ kind: 'insert', insertId: 'd1', field: 'mix' });
    const strip = formatTargetId({ kind: 'strip', field: 'level' });
    const points = [{ tick: 0, value: 0.5 }];
    // CC 20 and 21: the mod wheel (1) and sustain (64) are never mappable.
    const cc = { source: { device: null, channel: null, cc: 20 }, min: 0, max: 1, inverted: false };
    model.merge(
      raw({
        parts: {
          [arp]: {
            strip: {
              inserts: [
                { kind: 'drive', id: 'd1' },
                { kind: 'chorus', id: 'zz' },
              ],
            },
            automation: [
              { target: gone, points },
              { target: kept, points },
              { target: strip, points },
            ],
            ccMappings: [
              { ...cc, target: gone },
              { ...cc, source: { ...cc.source, cc: 21 }, target: kept },
            ],
          },
        },
      }),
    );
    expect(partAt(model.doc, arp)?.automation).toHaveLength(3);
    const partial = load(arp, rack());
    const fields = partFields(partial, arp);
    expect((fields['automation'] as { target: string }[]).map((lane) => lane.target)).toEqual([
      kept,
      strip,
    ]);
    expect((fields['ccMappings'] as { target: string }[]).map((m) => m.target)).toEqual([kept]);
    expect(partAt(model.doc, arp)?.automation?.map((lane) => lane.target)).toEqual([kept, strip]);
  });

  it('drops a lane on a kept host id whose slot child or kind the rack changed', () => {
    const model = song();
    const { load, ids } = scope(model);
    const slotRate = formatTargetId({ kind: 'insert', insertId: 'e1', field: 'slot.rate' });
    const mix = formatTargetId({ kind: 'insert', insertId: 'e1', field: 'mix' });
    const lanes = () => partAt(model.doc, arp)?.automation?.map((lane) => lane.target);
    const withLanes = () =>
      model.merge(
        raw({
          parts: {
            [arp]: {
              strip: { inserts: [{ kind: 'echo', id: 'e1', slot: { kind: 'chorus', id: 'c9' } }] },
              automation: [slotRate, mix].map((target) => ({
                target,
                points: [{ tick: 0, value: 0.5 }],
              })),
            },
          },
        }),
      );
    const bare = rackFromPart(model.doc, kick, BARE, ids) as RackFile;
    // The host kept with its slot emptied: the slot lane goes, the host's own stays.
    withLanes();
    expect(lanes()).toEqual([slotRate, mix]);
    load(arp, { id: 'echo-rack', file: { ...bare, inserts: chain([{ kind: 'echo', id: 'e1' }]) } });
    expect(lanes()).toEqual([mix]);
    // The id kept but of another kind now: a row that kind has stays, a row it lacks goes.
    withLanes();
    load(arp, {
      id: 'drive-rack',
      file: { ...bare, inserts: chain([{ kind: 'drive', id: 'e1' }]) },
    });
    expect(lanes()).toEqual([mix]);
  });

  it("drops a sequencer lane the rack's kind does not offer, and keeps one it does", () => {
    const model = song();
    const { load, ids } = scope(model);
    const density = seqTargetId('density');
    const gate = seqTargetId('gate');
    const points = [{ tick: 0, value: 0.5 }];
    // A Bass part with its two sequencer lanes; an Arp rack offers gate but not density.
    model.merge(raw({ parts: { [arp]: { sequencer: { kind: 'bass', seed: 0 } } } }));
    model.merge(
      raw({
        parts: {
          [arp]: {
            automation: [
              { target: density, points },
              { target: gate, points },
            ],
          },
        },
      }),
    );
    expect(partAt(model.doc, arp)?.automation).toHaveLength(2);
    const asArp = model.preview(setSequencerKind(model.doc, hat, 'arp'));
    const bare = rackFromPart(model.doc, kick, BARE, ids) as RackFile;
    const file = { ...bare, sequencer: withoutSeed(partAt(asArp, hat)!.sequencer) };
    const fields = partFields(load(arp, { id: 'arp-rack', file }), arp);
    expect((fields['automation'] as { target: string }[]).map((lane) => lane.target)).toEqual([
      gate,
    ]);
    expect(partAt(model.doc, arp)?.automation?.map((lane) => lane.target)).toEqual([gate]);
  });

  it("keeps a same-kind part's seed and region patterns, and drops another kind's", () => {
    const model = song();
    const { rack, load } = scope(model);
    const euclid = withoutSeed(partAt(model.doc, kick)!.sequencer);
    const grid = withoutSeed(partAt(model.doc, arp)!.sequencer);
    const region = (slot: number, pattern: unknown) => [
      { ...partAt(model.doc, slot)!.regions[0], pattern },
    ];
    model.merge(
      raw({
        parts: {
          [kick]: { sequencer: { seed: 7 }, regions: region(kick, euclid) },
          [arp]: { regions: region(arp, grid) },
        },
      }),
    );
    const ref = rack();
    const same = partFields(load(kick, ref), kick);
    expect((same['sequencer'] as { seed: number }).seed).toBe(7);
    expect('regions' in same).toBe(false);
    expect(partAt(model.doc, kick)?.regions[0]?.pattern).toBeDefined();
    const other = partFields(load(arp, ref), arp);
    expect(other['regions']).toEqual([
      { start: 0, duration: FULL_DOCUMENT.parts[0]!.regions[0]!.duration },
    ]);
    expect(partAt(model.doc, arp)?.regions[0]?.pattern).toBeUndefined();
  });

  it('leaves a part with one ∞ region none when the rack is a Roll', () => {
    const model = song();
    const { load, ids } = scope(model);
    const asRoll = model.preview(setSequencerKind(model.doc, hat, 'roll'));
    const roll = withoutSeed(partAt(asRoll, hat)!.sequencer);
    const ref: RackRef = {
      id: 'roll-rack',
      file: { ...(rackFromPart(model.doc, kick, BARE, ids) as RackFile), sequencer: roll },
    };
    const fields = partFields(load(drone, ref), drone);
    expect(fields['regions']).toEqual([]);
    expect(partAt(model.doc, drone)?.sequencer.kind).toBe('roll');
  });

  it("leaves the part's low cut and sequencer alone when the rack carries neither", () => {
    const model = song();
    const { rack, load } = scope(model);
    const before = partAt(model.doc, arp)!;
    const fields = partFields(load(arp, rack(BARE)), arp);
    expect('sequencer' in fields || 'regions' in fields).toBe(false);
    expect(fields['strip']).toEqual({ inserts: rack(BARE).file.inserts });
    const after = partAt(model.doc, arp)!;
    expect(after.sequencer).toEqual(before.sequencer);
    expect(after.strip.lowCut).toBe(before.strip.lowCut);
  });

  it('is null for an empty slot', () => {
    const model = song();
    const { rack, library, auto } = scope(model);
    expect(loadRackChange(model.doc, 9, rack(), library, auto)).toBeNull();
  });
});
