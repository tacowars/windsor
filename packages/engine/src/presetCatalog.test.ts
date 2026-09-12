import { describe, expect, it } from 'vitest';
import { filterPresets, listPresets, PRESET_CATALOG } from './presetCatalog';
import { clonePatch, makePatch } from './patch';
import { PRESETS, PRESET_NAMES } from './presets';
import { SCORING_CATALOG } from './presetsScoring';
import { makeArrangement } from './arrangementDocument';
import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';

const empty = { query: '', category: '', tag: '', source: '' };
describe('scoring catalog', () => {
  it('adds the requested 100 unique sounds with complete metadata', () => {
    expect(SCORING_CATALOG).toHaveLength(100);
    expect(new Set(SCORING_CATALOG.map((entry) => entry.id)).size).toBe(SCORING_CATALOG.length);
    expect(Object.keys(PRESET_CATALOG).sort()).toEqual([...PRESET_NAMES].sort());
    expect(new Set(SCORING_CATALOG.map((entry) => entry.category))).toEqual(
      new Set(['Strings', 'Pads', 'Plucks', 'Basses', 'Soundtrack FX']),
    );
    for (const entry of SCORING_CATALOG) {
      expect(entry.tags.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(PRESETS[entry.id]).toBe(entry.patch);
    }
  });
  it('has distinct synthesis settings, not just distinct names', () => {
    const sounds = SCORING_CATALOG.map(({ patch }) => JSON.stringify({ ...patch, name: '' }));
    expect(new Set(sounds).size).toBe(sounds.length);
  });
  it('matches words across names and tags, intersects filters, and handles no matches', () => {
    const entries = listPresets();
    const matches = filterPresets(entries, {
      ...empty,
      query: '  CONCRETE dub ',
      category: 'Plucks',
      tag: 'muted',
    });
    expect(matches.map((entry) => entry.id)).toEqual(['score-concrete-chord']);
    expect(filterPresets(entries, { ...empty, query: 'zzzzzz' })).toEqual([]);
    expect(filterPresets(entries, { ...empty, query: 'concrete', tag: 'airy' })).toEqual([]);
  });
  it('hides legacy gameplay sounds by default but retains explicit access', () => {
    expect(filterPresets(listPresets(), empty).some((entry) => entry.id === 'weapon-zap')).toBe(
      false,
    );
    expect(
      filterPresets(listPresets(), { ...empty, category: 'Legacy game FX' }).map(
        (entry) => entry.id,
      ),
    ).toContain('weapon-zap');
  });
  it('lists document shadows once, uses their names, and includes custom patches', () => {
    const entries = listPresets({
      'score-concrete-chord': makePatch({ name: 'My chord' }),
      custom: makePatch({ name: 'My sound' }),
    });
    expect(entries.filter((entry) => entry.id === 'score-concrete-chord')).toHaveLength(1);
    expect(entries.find((entry) => entry.id === 'score-concrete-chord')).toMatchObject({
      name: 'My chord',
      source: 'document',
      category: 'Plucks',
    });
    expect(
      filterPresets(entries, { ...empty, source: 'document' })
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(['custom', 'score-concrete-chord']);
  });
  it('normalises and round trips every new patch, including user harmonics', () => {
    for (const { id, patch } of SCORING_CATALOG) {
      const result = makeArrangement({
        ...FULL_ARRANGEMENT,
        arp: { ...FULL_ARRANGEMENT.arp, preset: id },
        patches: { [id]: clonePatch(patch) },
      });
      expect(result.corrections, id).toEqual([]);
      expect(result.dangling, id).toEqual([]);
      const imported = makeArrangement(JSON.parse(JSON.stringify(result.document)));
      expect(imported.document.patches?.[id], id).toEqual(patch);
    }
  });
});
