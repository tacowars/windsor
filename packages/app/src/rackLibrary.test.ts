/**
 * The library model's rack side (windsor#868, record `2026-10-17-racks`
 * decision 15) over an in-memory store: a read that keeps an old rack and
 * names a broken one, a write and a remove that re-read, the download path
 * without a store, and the one problem toast covering patches and racks.
 */
import { describe, expect, it } from 'vitest';

import type { RackFile } from '@windsor/engine';
import { RACK_FILE_FORMAT, serialiseRackFile } from '@windsor/engine';
import { FULL_DOCUMENT, FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import { DocumentModel } from './documentModel';
import type { PatchFolder } from './libraryFolder';
import { disconnectLibrary, libraryProblemsText, pageLibrary } from './libraryModel';
import { rackFromPart } from './rackActions';
import {
  connectUserRacks,
  exportOldFormatRack,
  isRackWritable,
  rackEntry,
  refreshRacks,
  removeOldFormatRack,
  removeRackFile,
  writeRackFile,
} from './rackLibrary';

const META = { name: 'Kick Rack', category: 'Drums', tags: [], description: '' };

function goodRack(): RackFile {
  const model = new DocumentModel(FULL_DOCUMENT);
  const options = { ...META, lowCut: false, sequencer: false };
  return rackFromPart(model.doc, FULL_SLOT.kick, options, new Set(['kick'])) as RackFile;
}

function folder(files: Map<string, string>): PatchFolder & { files: Map<string, string> } {
  return {
    name: 'racks',
    files,
    list: () => Promise.resolve([...files.keys()]),
    read: (name) => Promise.resolve(files.get(name) ?? Promise.reject(new Error(name))),
    write: (name, text) => {
      files.set(name, text);
      return Promise.resolve();
    },
    remove: (name) => {
      files.delete(name);
      return Promise.resolve();
    },
  };
}

/** A store with a good rack, one of a future format, one that is no rack file at all, and one the loader clamps. */
function store() {
  const good = goodRack();
  const old = { ...JSON.parse(serialiseRackFile(good)), format: RACK_FILE_FORMAT + 1 };
  const broken = { ...JSON.parse(serialiseRackFile(good)), kind: 'kit' };
  const clamped = {
    ...JSON.parse(serialiseRackFile(good)),
    inserts: [{ kind: 'drive', id: 'd1', drive: 999 }],
  };
  return folder(
    new Map([
      ['kick-rack.json', serialiseRackFile(good)],
      ['old-rack.json', `${JSON.stringify(old)}\n`],
      ['broken.json', `${JSON.stringify(broken)}\n`],
      ['loud-rack.json', `${JSON.stringify(clamped)}\n`],
    ]),
  );
}

describe('reading the rack store', () => {
  it('lists the good rack, keeps the old one and names the broken one', async () => {
    const model = pageLibrary();
    await connectUserRacks(model, store());
    expect(Object.keys(model.racks)).toEqual(['kick-rack', 'loud-rack']);
    expect(rackEntry(model, 'kick-rack')?.name).toBe('Kick Rack');
    expect(isRackWritable(model, 'kick-rack')).toBe(true);
    expect(isRackWritable(model, 'old-rack')).toBe(false);
    expect(model.oldFormatRacks.map((entry) => [entry.id, entry.refusal.format])).toEqual([
      ['old-rack', 'rack'],
    ]);
    expect(model.rackProblems).toHaveLength(1);
    expect(model.rackProblems[0]).toMatch(/^racks\/broken\.json: kind: expected "rack"/);
  });

  it('keeps a rack the loader corrected, and names the correction apart from the refusals', async () => {
    const model = pageLibrary();
    await connectUserRacks(model, store());
    expect(rackEntry(model, 'loud-rack')).toBeDefined();
    expect(model.rackNotes).toHaveLength(1);
    expect(model.rackNotes[0]).toMatch(/^rack "loud-rack": inserts\[0\]\.drive/);
    expect(model.rackProblems).toHaveLength(1);
  });

  it('is empty without a store', async () => {
    const model = pageLibrary();
    await connectUserRacks(model, null);
    expect(model.racks).toEqual({});
    expect(model.rackProblems).toEqual([]);
  });

  it('survives a folder disconnect', async () => {
    const model = pageLibrary();
    await connectUserRacks(model, store());
    await disconnectLibrary(model);
    expect(Object.keys(model.racks)).toEqual(['kick-rack', 'loud-rack']);
    expect(model.rackNotes).toHaveLength(1);
    expect(model.userRacks).not.toBeNull();
  });
});

describe('writing and removing', () => {
  it('writes a rack into the store and re-reads, then removes it', async () => {
    const model = pageLibrary();
    const files = store();
    await connectUserRacks(model, files);
    const mine = { ...goodRack(), name: 'Mine', patch: { ...goodRack().patch, name: 'Mine' } };
    await writeRackFile(model, 'mine', serialiseRackFile(mine));
    expect(files.files.has('mine.json')).toBe(true);
    expect(rackEntry(model, 'mine')?.name).toBe('Mine');
    await removeRackFile(model, 'mine');
    expect(rackEntry(model, 'mine')).toBeUndefined();
    expect(files.files.has('mine.json')).toBe(false);
  });

  it('exports and deletes an old-format rack, which is kept and never loaded', async () => {
    const model = pageLibrary();
    const files = store();
    await connectUserRacks(model, files);
    const exported: [string, string][] = [];
    exportOldFormatRack(model, 'old-rack', (id, text) => void exported.push([id, text]));
    expect(exported).toEqual([['old-rack', files.files.get('old-rack.json')]]);
    expect(() => exportOldFormatRack(model, 'kick-rack')).toThrow(/not an old-format rack/);
    await removeOldFormatRack(model, 'old-rack');
    expect(files.files.has('old-rack.json')).toBe(false);
    expect(model.oldFormatRacks).toEqual([]);
    await expect(removeOldFormatRack(model, 'kick-rack')).rejects.toThrow(/not an old-format rack/);
    expect(rackEntry(model, 'kick-rack')).toBeDefined();
  });

  it('refuses to remove what is not one of the user racks', async () => {
    const model = pageLibrary();
    await connectUserRacks(model, store());
    await expect(removeRackFile(model, 'old-rack')).rejects.toThrow(/not one of your racks/);
    await expect(removeRackFile(pageLibrary(), 'kick-rack')).rejects.toThrow(/cannot store racks/);
  });

  it('downloads and keeps the entry in memory without a store, and refuses a bad file', async () => {
    const model = pageLibrary();
    const downloads: string[] = [];
    const download = (id: string): void => void downloads.push(id);
    await writeRackFile(model, 'kick-rack', serialiseRackFile(goodRack()), download);
    expect(downloads).toEqual(['kick-rack']);
    expect(rackEntry(model, 'kick-rack')?.name).toBe('Kick Rack');
    expect(isRackWritable(model, 'kick-rack')).toBe(true);
    await writeRackFile(model, 'bad', '{"kind":"rack"}', download);
    expect(rackEntry(model, 'bad')).toBeUndefined();
    expect(model.rackProblems).toHaveLength(1);
    expect(model.rackNotes).toEqual([]);
  });
});

describe('the problem toast', () => {
  it('counts the patch refusals, the rack refusals and the rack corrections apart', async () => {
    const model = pageLibrary();
    expect(libraryProblemsText(model)).toBeNull();
    await connectUserRacks(model, store());
    expect(libraryProblemsText(model)).toMatch(
      /^library: 1 rack file\(s\) refused — racks\/broken\.json: .* library: 1 rack correction\(s\) on load — rack "loud-rack"/,
    );
    model.problems = ['patches/x.json: bad'];
    expect(libraryProblemsText(model)).toMatch(
      /^library: 1 patch file\(s\) refused — patches\/x\.json: bad library: 1 rack file\(s\)/,
    );
    await refreshRacks(model);
    expect(model.rackProblems).toHaveLength(1);
    expect(model.rackNotes).toHaveLength(1);
  });
});
