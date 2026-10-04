/**
 * An operator's `opLp`, `opHp` and `opTrack` (windsor#362, renamed and
 * joined by the tracking in windsor#590): `makePatch` fills 0 (off,
 * untracked) where a patch omits them, so a file or a song that omits them
 * loads with no correction and plays as it did; one that sets them keeps
 * all three through a patch file's save and load, a merge, and a song's
 * export and import. The rename from format 3 is `patchMigrations.test.ts`
 * and `song/songMigrations.test.ts`; what the fields do to the sound is
 * `synth/fmProcessorOperatorFilter.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from '../song/arrangementDocument';
import { WAVE, makePatch, mergePatch } from './patch';
import type { PartialPatch } from './patch';
import { PATCH_FILE_FORMAT, loadPatchFile } from './patchLibrary';
import { serialisePatchFile } from './patchFileSerialise';
import { PRESETS } from './presets';

/** The two-pole fit's cutoffs for the 808 snare's noise (windsor#361, optimizer seed 1), tracked. */
const COLOUR = { opLp: 10089.029530313479, opHp: 2370.0400654924615, opTrack: 0.5 };

const colouredPatch = (): PartialPatch => ({
  name: 'probe-590',
  ops: [
    { level: 1 },
    { wave: WAVE.SAW, level: 0.5, opLp: 900.5 },
    { wave: WAVE.NOISE, level: 0.8, ...COLOUR },
    {},
  ],
});

describe("an operator's own filter fields (windsor#362, windsor#590)", () => {
  it('fills 0 on every operator of a patch that omits them, and in every library patch', () => {
    expect(makePatch().ops.map((op) => [op.opLp, op.opHp, op.opTrack])).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    for (const [id, patch] of Object.entries(PRESETS)) {
      for (const op of patch.ops) expect([op.opLp, op.opHp, op.opTrack], id).toEqual([0, 0, 0]);
    }
  });

  it("keeps them through a patch file's save and load, and through a merge", () => {
    const raw = {
      format: PATCH_FILE_FORMAT,
      name: 'probe-590',
      category: 'drums',
      tags: [],
      description: 'windsor#590 round trip',
      patch: colouredPatch(),
    };
    const loaded = loadPatchFile('probe-590', raw);
    expect(loaded.patch.ops[2]).toMatchObject(COLOUR);
    expect(loaded.patch.ops[1]).toMatchObject({ opLp: 900.5, opHp: 0, opTrack: 0 });
    const again = loadPatchFile('probe-590', JSON.parse(serialisePatchFile(loaded)) as unknown);
    expect(again.patch).toEqual(loaded.patch);
    // A merge replaces `ops` wholesale; an edit elsewhere keeps the operators' fields.
    const merged = mergePatch(loaded.patch, { volume: 0.5 });
    expect(merged.volume).toBe(0.5);
    expect(merged.ops[2]).toMatchObject(COLOUR);
  });

  it("keeps them through a song's export and import, and fills 0 for a song without them, with no correction", () => {
    const patches = { snare: colouredPatch(), kick: {} };
    const first = makeArrangement(song([KICK], { patches }));
    expect(first.corrections).toEqual([]);
    expect(first.document.patches!['snare']!.ops[2]).toMatchObject(COLOUR);
    expect(first.document.patches!['kick']!.ops[2]).toMatchObject({ opLp: 0, opHp: 0, opTrack: 0 });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)) as unknown);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
