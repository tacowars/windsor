/**
 * The rack loader (windsor#862, record `2026-10-17-racks` decisions 6 to 8)
 * against a rack built from the full fixture's kick, and against the ways a
 * hand-written or console-written file can go wrong.
 */
import { describe, expect, it } from 'vitest';

import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ } from '../audioConstants';
import { FULL_DOCUMENT, FULL_PARTS } from '../__fixtures__/fullArrangement';
import { DRIVE_GAIN_MAX_DB } from '../inserts/insertConstants';
import { DEFAULT_DRIVE } from '../inserts/driveInsert';
import { DEFAULT_COMPRESSOR } from '../inserts/compressorSpec';
import { normaliseInserts } from '../inserts/insertRegistry';
import type { Patch } from '../patch/patch';
import { PATCH_FILE_FORMAT, patchLeafDifferences } from '../patch/patchLibrary';
import { FieldNormaliser } from '../song/arrangementFields';
import { RACK_FILE_FORMAT, loadRackFile } from './rackFile';
import type { RackFile } from './rackFile';
import { serialiseRackFile } from './rackFileSerialise';
import { RackFormatError } from './rackMigrations';

const KICK_PATCH = FULL_DOCUMENT.patches['kick'] as Patch;

/** `object` minus `keys`, so a "missing field" case reads as what it is. */
function without<T extends object>(object: T, ...keys: (keyof T)[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(object as Record<string, unknown>) };
  for (const key of keys) delete copy[key as string];
  return copy;
}

/** The fixture kick's sequencer without its seed, as a rack carries it. */
const kickPattern = (): Record<string, unknown> => without(FULL_PARTS.kick.sequencer, 'seed');

/** A chain as the console would save it: normalised, every insert with its id. */
const chain = (raw: unknown[]): RackFile['inserts'] =>
  normaliseInserts(raw, 'inserts', new FieldNormaliser());

/** A full rack: the kick's patch, a drive and an internally keyed compressor, a low cut and the pattern. */
const fullRack = (): RackFile => ({
  format: RACK_FILE_FORMAT,
  kind: 'rack',
  name: KICK_PATCH.name,
  category: 'Drums',
  tags: ['kick', 'probe'],
  description: 'A rack that exists only inside this test.',
  patchFormat: PATCH_FILE_FORMAT,
  patch: KICK_PATCH,
  patchSource: 'kick',
  lowCut: 80,
  sequencer: kickPattern() as NonNullable<RackFile['sequencer']>,
  inserts: chain([{ ...DEFAULT_DRIVE, drive: 18 }, DEFAULT_COMPRESSOR]),
});

/** The least a rack can be: a patch and an empty chain. */
const bareRack = (): RackFile => ({
  format: RACK_FILE_FORMAT,
  kind: 'rack',
  name: KICK_PATCH.name,
  category: 'Drums',
  tags: [],
  description: '',
  patchFormat: PATCH_FILE_FORMAT,
  patch: KICK_PATCH,
  inserts: [],
});

/** A file as it would be read back from disk or a store: through its text. */
const reread = (file: RackFile): unknown => JSON.parse(serialiseRackFile(file));

/** `file` with `patch` set over the top, so a case reads as what it changes. */
const withPatch = (file: RackFile, patch: Record<string, unknown>): Record<string, unknown> => ({
  ...(reread(file) as Record<string, unknown>),
  patch: { ...(KICK_PATCH as unknown as Record<string, unknown>), ...patch },
});

describe('a rack file round trip', () => {
  it('loads a full rack back leaf-identical, with nothing to report', () => {
    const file = fullRack();
    const entry = loadRackFile('kick-rack', reread(file));
    expect(entry.id).toBe('kick-rack');
    expect(entry.problems).toEqual([]);
    expect(patchLeafDifferences(entry.patch, file.patch)).toEqual([]);
    expect(entry.inserts).toEqual(file.inserts);
    expect(entry.lowCut).toBe(80);
    expect(entry.patchSource).toBe('kick');
    expect(entry.sequencer).toEqual(file.sequencer);
    expect(entry.sequencer && 'seed' in entry.sequencer).toBe(false);
    const back = without(entry, 'id', 'problems') as unknown as RackFile;
    expect(serialiseRackFile(back)).toBe(serialiseRackFile(file));
  });

  it('writes the keys in file order and leaves an absent optional out', () => {
    expect(Object.keys(reread(fullRack()) as object)).toEqual([
      'format',
      'kind',
      'name',
      'category',
      'tags',
      'description',
      'patchFormat',
      'patch',
      'patchSource',
      'lowCut',
      'sequencer',
      'inserts',
    ]);
    const bare = reread(bareRack()) as Record<string, unknown>;
    expect('patchSource' in bare || 'lowCut' in bare || 'sequencer' in bare).toBe(false);
  });

  it('loads a bare rack: an empty chain and no optional member', () => {
    const entry = loadRackFile('bare', reread(bareRack()));
    expect(entry.inserts).toEqual([]);
    expect('patchSource' in entry || 'lowCut' in entry || 'sequencer' in entry).toBe(false);
    expect(entry.problems).toEqual([]);
  });

  it('keeps the insert ids it was saved with', () => {
    const file = fullRack();
    const ids = file.inserts.map((spec) => spec.id);
    expect(loadRackFile('kick-rack', reread(file)).inserts.map((spec) => spec.id)).toEqual(ids);
  });
});

describe('what loading fills or corrects without refusing', () => {
  it('fills a missing insert field from its kind, silently', () => {
    const raw = { ...(reread(bareRack()) as object), inserts: [{ kind: 'drive', id: 'd1' }] };
    const entry = loadRackFile('fill', raw);
    expect(entry.inserts).toEqual([{ ...DEFAULT_DRIVE, id: 'd1' }]);
    expect(entry.problems).toEqual([]);
  });

  it('clamps a chain number and lists the clamp', () => {
    const over = DRIVE_GAIN_MAX_DB + 1;
    const raw = {
      ...(reread(bareRack()) as object),
      inserts: [{ ...DEFAULT_DRIVE, id: 'd1', drive: over }],
    };
    const entry = loadRackFile('clamp', raw);
    expect(entry.inserts[0]).toEqual({ ...DEFAULT_DRIVE, id: 'd1', drive: DRIVE_GAIN_MAX_DB });
    expect(entry.problems).toHaveLength(1);
    expect(entry.problems[0]).toContain('inserts[0].drive');
  });

  it('drops a seed inside the sequencer silently', () => {
    const raw = { ...(reread(bareRack()) as object), sequencer: { ...kickPattern(), seed: 99 } };
    const entry = loadRackFile('seeded', raw);
    expect(entry.sequencer).toEqual(kickPattern());
    expect(entry.problems).toEqual([]);
  });

  it.each([['internal'], [{ track: null }]])('loads a compressor keyed %j', (sidechain) => {
    const raw = {
      ...(reread(bareRack()) as object),
      inserts: [{ ...DEFAULT_COMPRESSOR, id: 'c1', sidechain }],
    };
    expect(loadRackFile('keyed', raw).problems).toEqual([]);
  });

  it('upgrades the embedded patch from an older patch format', () => {
    const ops = KICK_PATCH.ops.map((op, i) => (i === 0 ? { ...op, userKey: 'retired' } : op));
    const raw = { ...withPatch(bareRack(), { ops }), patchFormat: 1 };
    const entry = loadRackFile('old-patch', raw);
    expect(entry.patchFormat).toBe(PATCH_FILE_FORMAT);
    expect(patchLeafDifferences(entry.patch, KICK_PATCH)).toEqual([]);
  });
});

describe('what refuses a rack file', () => {
  const file = (): Record<string, unknown> => reread(fullRack()) as Record<string, unknown>;

  it.each([
    ['a patch file', { kind: undefined }, /kind: expected "rack", got undefined/],
    ['another kind', { kind: 'kit' }, /kind: expected "rack"/],
    ['an unknown key', { extra: 1 }, /unknown field extra/],
    ['a chain that is not a list', { inserts: {} }, /inserts: expected an array/],
    ['a junk entry', { inserts: [7] }, /inserts\[0\]: expected an object/],
    ['an unknown insert kind', { inserts: [{ kind: 'wobble' }] }, /no insert kind "wobble"/],
    [
      'a compressor keyed from a slot',
      { inserts: [{ ...DEFAULT_COMPRESSOR, sidechain: { track: 2 } }] },
      /inserts\[0\]\.sidechain: keyed from slot 2/,
    ],
    ['a sequencer that is not an object', { sequencer: 'grid' }, /sequencer: expected an object/],
    [
      'an unknown sequencer kind',
      { sequencer: { kind: 'tracker' } },
      /no sequencer kind "tracker"/,
    ],
    ['a low cut under the floor', { lowCut: LOW_CUT_MIN_HZ - 1 }, /lowCut: expected a number/],
    ['a low cut over the ceiling', { lowCut: LOW_CUT_MAX_HZ + 1 }, /lowCut: expected a number/],
    ['a low cut that is not a number', { lowCut: '80' }, /lowCut: expected a number/],
    [
      'a patch source that is no slug',
      { patchSource: 'Kick Drum' },
      /patchSource: expected a patch id slug/,
    ],
    ['a name that is not the patch name', { name: 'Other' }, /name "Other" ≠ patch\.name/],
    ['empty tags', { tags: ['', 'x'] }, /tags: expected an array of non-empty strings/],
  ])('%s', (_case, over, message) => {
    expect(() => loadRackFile('bad', { ...file(), ...over })).toThrow(message);
  });

  it('refuses a missing required key by name', () => {
    expect(() => loadRackFile('bad', without(file(), 'inserts'))).toThrow(/missing field inserts/);
    expect(() => loadRackFile('bad', without(file(), 'patchFormat', 'tags'))).toThrow(
      /missing fields tags, patchFormat/,
    );
  });

  it('names every problem in one error, prefixed with the file', () => {
    expect(() => loadRackFile('bad', { ...file(), lowCut: 1, patchSource: 7 })).toThrow(
      /^racks\/bad\.json: patchSource: .*; lowCut: /,
    );
  });

  it('refuses an unknown patch key and a wrong-typed leaf by the patch rules', () => {
    expect(() => loadRackFile('bad', withPatch(fullRack(), { bogus: 1 }))).toThrow(
      /patch: unknown field bogus/,
    );
    expect(() => loadRackFile('bad', withPatch(fullRack(), { volume: 'loud' }))).toThrow(
      /patch\.volume: expected a number/,
    );
  });

  it('refuses a chain past the insert limit', () => {
    const inserts = Array.from({ length: 9 }, () => ({ ...DEFAULT_DRIVE }));
    expect(() => loadRackFile('long', { ...file(), inserts })).toThrow(/at most 8/);
  });

  it('refuses an id that is not a slug', () => {
    expect(() => loadRackFile('Kick Rack', file())).toThrow(/is not a slug/);
  });

  it.each([
    [
      'a rack format ahead of this build',
      { format: RACK_FILE_FORMAT + 1 },
      'rack',
      RACK_FILE_FORMAT,
    ],
    [
      'a patch format ahead of this build',
      { patchFormat: PATCH_FILE_FORMAT + 1 },
      'patch',
      PATCH_FILE_FORMAT,
    ],
  ])('%s is a RackFormatError whose refusal names the formats', (_case, over, format, reads) => {
    let caught: unknown;
    try {
      loadRackFile('future', { ...file(), ...over });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RackFormatError);
    const { refusal, id } = caught as RackFormatError;
    expect(id).toBe('future');
    expect(refusal.format).toBe(format);
    expect(refusal.reads).toBe(reads);
    expect(refusal.found).toBe(reads + 1);
  });

  it('leaves a format that is not an integer to the validator', () => {
    expect(() => loadRackFile('bad', { ...file(), format: '1' })).toThrow(
      /format: expected 1, got "1"/,
    );
    expect(() => loadRackFile('bad', { ...file(), patchFormat: 4.5 })).toThrow(
      /patchFormat: expected 4, got 4.5/,
    );
  });
});
