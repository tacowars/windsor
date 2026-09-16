/**
 * #586 added `filter.modWheelDepth` to the worklet and `"modWheelDepth": 0` to
 * every `patches/*.json`, refreshing each `contentHash` without a re-sweep.
 * This is the proof that neither changed a render: every library patch at its
 * recorded headroom seed, on the new engine with the migrated file, hashes to
 * the byte the pre-change capture recorded
 * (`__fixtures__/patchLibraryRenders586.json`, committed from main at a6953a0b
 * before any engine edit), and peaks at the value the sweep recorded.
 *
 * A byte-equal Float32 buffer is `Object.is`-equal sample by sample (the hash
 * is over the IEEE-754 bit patterns, so `-0` and `0` differ and one ulp
 * differs; a non-finite sample is refused before hashing). Retired in the same
 * PR once it passed, as #583 retired #561's: the library is data the editor
 * saves over (#564 decision 6), so a test pinning it to a past capture fails
 * on the first real edit.
 */
import { describe, expect, it } from 'vitest';

import { renderRecord } from './__fixtures__/makePatchLibrary586Fixture';
import before from './__fixtures__/patchLibraryRenders586.json';
import { loadProcessor } from './__fixtures__/workletHarness';
import { PATCH_LIBRARY, PRESET_NAMES } from './presets';

const loaded = loadProcessor();
/** A hundredth of an octave on the envelope amount: small, but not a rounding. */
const NUDGE_OCTAVES = 0.01;

describe('the library renders bit-identically to the pre-#586 capture', () => {
  it('holds exactly the ids the fixture recorded', () => {
    expect([...PRESET_NAMES].sort()).toEqual([...before.ids].sort());
  });

  it.each(before.ids)('%s: same Float32 output, same peak, at its recorded seed', (id) => {
    const expected = before.entries[id as keyof typeof before.entries];
    const entry = PATCH_LIBRARY[id];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect(entry.patch.filter.modWheelDepth).toBe(0);
    expect(entry.headroom.worstSeed).toBe(expected.seed);
    const actual = renderRecord(loaded, entry.patch, entry.headroom.worstSeed);
    expect(actual.samples).toBe(expected.samples);
    expect(actual.sha256).toBe(expected.sha256);
    expect(Object.is(actual.peak, expected.peak), `${id} peak`).toBe(true);
    expect(Object.is(actual.peak, entry.headroom.peak), `${id} recorded peak`).toBe(true);
  });

  it('would notice the envelope term changing a render', () => {
    // The wheel is at 0 in the headroom render, so the term the change touched
    // moves a sample only through envAmount: nudge it and the hash must move.
    const id = 'ai-voice';
    const expected = before.entries[id];
    const nudged = structuredClone(PATCH_LIBRARY[id]?.patch);
    expect(nudged).toBeDefined();
    if (!nudged) return;
    nudged.filter.envAmount += NUDGE_OCTAVES;
    const result = renderRecord(loaded, nudged, expected.seed);
    expect(result.sha256).not.toBe(expected.sha256);
  });
});
