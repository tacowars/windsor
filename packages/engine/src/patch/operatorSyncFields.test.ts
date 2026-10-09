/**
 * An operator's `sync` and both LFOs' `toRatio` (windsor#646, record
 * `2026-10-09-operator-hard-sync` decision 11): additive fields whose
 * defaults, `'off'` and zeros, reproduce the old sound, so a file or a song
 * without them loads with no correction and no format change; one that sets
 * them keeps both through a patch file's save and load, a merge, and a
 * song's export and import. `makePatch` keeps the sync rule the worklet
 * keeps (an unknown master and a cycle are off, `patchDefaults.test.ts`).
 * What the fields do to the sound is `synth/fmProcessorSync.test.ts` and
 * `synth/fmProcessorRatioTarget.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from '../song/arrangementDocument';
import { OP_NAMES, OP_SYNC_VALUES, WAVE, makePatch, mergePatch } from './patch';
import type { PartialPatch } from './patch';
import { PATCH_FILE_FORMAT, loadPatchFile } from './patchLibrary';
import { serialisePatchFile } from './patchFileSerialise';
import { PRESETS } from './presets';

const syncedPatch = (): PartialPatch => ({
  name: 'probe-646',
  ops: [
    { level: 1, sync: 'B' },
    { wave: WAVE.SAW, level: 0.5, ratio: 2.37, sync: 'note' },
    {},
    { sync: 'A' },
  ],
  lfo: { amount: 0.5, toRatio: [0, 1.5, 0, 0] },
  lfo2: { toRatio: [0, 0, -0.25, 0] },
});

const syncs = (patch: { ops: { sync: string }[] }): string[] => patch.ops.map((op) => op.sync);

describe('the sync and ratio-depth fields (windsor#646)', () => {
  it('name the operators’ masters by the operators’ own letters', () => {
    expect(OP_SYNC_VALUES).toEqual(['off', 'note', ...OP_NAMES]);
  });

  it('fill off and zeros where a patch omits them, as every library patch does', () => {
    const patch = makePatch();
    expect(syncs(patch)).toEqual(['off', 'off', 'off', 'off']);
    expect([patch.lfo.toRatio, patch.lfo2.toRatio]).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    for (const [id, preset] of Object.entries(PRESETS)) {
      if (!id.startsWith('lead-sync'))
        expect(syncs(preset), id).toEqual(['off', 'off', 'off', 'off']);
    }
  });

  it('turn an unknown master and a cycle off in makePatch, as the worklet does', () => {
    const cycle = makePatch({
      ops: [{ sync: 'B' }, { sync: 'A' }, { sync: 'B' }, { sync: 'X' as never }],
    });
    expect(syncs(cycle)).toEqual(['off', 'off', 'B', 'off']);
  });

  it("keep both through a patch file's save and load, and through a merge", () => {
    const raw = {
      format: PATCH_FILE_FORMAT,
      name: 'probe-646',
      category: 'Lead',
      tags: [],
      description: 'windsor#646 round trip',
      patch: syncedPatch(),
    };
    const loaded = loadPatchFile('probe-646', raw);
    expect(syncs(loaded.patch)).toEqual(['B', 'note', 'off', 'A']);
    expect(loaded.patch.lfo.toRatio).toEqual([0, 1.5, 0, 0]);
    expect(loaded.patch.lfo2.toRatio).toEqual([0, 0, -0.25, 0]);
    const again = loadPatchFile('probe-646', JSON.parse(serialisePatchFile(loaded)) as unknown);
    expect(again.patch).toEqual(loaded.patch);
    const merged = mergePatch(loaded.patch, { volume: 0.5 });
    expect(syncs(merged)).toEqual(['B', 'note', 'off', 'A']);
    expect(merged.lfo.toRatio).toEqual([0, 1.5, 0, 0]);
  });

  it('load a file without them as off and zeros, with no problem', () => {
    const raw = {
      format: PATCH_FILE_FORMAT,
      name: 'probe-old',
      category: 'Lead',
      tags: [],
      description: 'before windsor#646',
      patch: { name: 'probe-old', ops: [{ level: 1 }, {}, {}, {}], lfo: { toWidth: [0, 0, 0, 0] } },
    };
    const loaded = loadPatchFile('probe-old', raw);
    expect(syncs(loaded.patch)).toEqual(['off', 'off', 'off', 'off']);
    expect(loaded.patch.lfo.toRatio).toEqual([0, 0, 0, 0]);
  });

  it("keep both through a song's export and import, and fill off and zeros for a song without them, with no correction", () => {
    const patches = { lead: syncedPatch(), kick: {} };
    const first = makeArrangement(song([KICK], { patches }));
    expect(first.corrections).toEqual([]);
    const lead = first.document.patches!['lead']!;
    expect(syncs(lead)).toEqual(['B', 'note', 'off', 'A']);
    expect(lead.lfo.toRatio).toEqual([0, 1.5, 0, 0]);
    expect(lead.lfo2.toRatio).toEqual([0, 0, -0.25, 0]);
    const kick = first.document.patches!['kick']!;
    expect(syncs(kick)).toEqual(['off', 'off', 'off', 'off']);
    expect(kick.lfo.toRatio).toEqual([0, 0, 0, 0]);
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)) as unknown);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
