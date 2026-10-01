/**
 * A Noise operator's `noiseLp` and `noiseHp` (windsor#362) are additive
 * fields: `makePatch` fills 0 (off) where a patch omits them, so a library
 * file or a song saved before them loads with no correction and plays as it
 * did; one that sets them keeps them through a patch file's save and load,
 * a merge, and a song's export and import. What they do to the sound is
 * `synth/fmProcessorNoiseColour.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { KICK, song } from '../__fixtures__/documentCases';
import { makeArrangement } from '../song/arrangementDocument';
import { WAVE, makePatch, mergePatch } from './patch';
import type { PartialPatch } from './patch';
import { PATCH_FILE_FORMAT, loadPatchFile } from './patchLibrary';
import { serialisePatchFile } from './patchFileSerialise';
import { PRESETS } from './presets';

/** The two-pole fit's cutoffs for the 808 snare's noise (windsor#361, optimizer seed 1). */
const COLOUR = { noiseLp: 10089.029530313479, noiseHp: 2370.0400654924615 };

const colouredPatch = (): PartialPatch => ({
  name: 'probe-362',
  ops: [{ level: 1 }, { level: 0.5 }, { wave: WAVE.NOISE, level: 0.8, ...COLOUR }, {}],
});

describe("a Noise operator's colour fields (windsor#362)", () => {
  it('fills 0 on every operator of a patch that omits them, and in every library patch', () => {
    expect(makePatch().ops.map((op) => [op.noiseLp, op.noiseHp])).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ]);
    for (const [id, patch] of Object.entries(PRESETS)) {
      for (const op of patch.ops) expect([op.noiseLp, op.noiseHp], id).toEqual([0, 0]);
    }
  });

  it("keeps them through a patch file's save and load, and through a merge", () => {
    const raw = {
      format: PATCH_FILE_FORMAT,
      name: 'probe-362',
      category: 'drums',
      tags: [],
      description: 'windsor#362 round trip',
      patch: colouredPatch(),
    };
    const loaded = loadPatchFile('probe-362', raw);
    expect(loaded.patch.ops[2]).toMatchObject(COLOUR);
    const again = loadPatchFile('probe-362', JSON.parse(serialisePatchFile(loaded)) as unknown);
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
    expect(first.document.patches!['kick']!.ops[2]).toMatchObject({ noiseLp: 0, noiseHp: 0 });
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)) as unknown);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });
});
