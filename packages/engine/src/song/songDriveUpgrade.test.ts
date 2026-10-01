/**
 * Song version 5 → 6 (windsor#300, record `2026-10-01-voice-drive-stage`): a
 * version-5 song's embedded patches are patch format 2, the drive inside the
 * filter. The upgrade moves it to the voice's drive stage, the song opens
 * with no correction, its patches render bit for bit as the library's
 * (which the golden test pins to the pre-windsor#300 render), and the result
 * survives export and import.
 */
import { describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION } from '../audioConstants';
import { KICK, PATCHES, song } from '../__fixtures__/documentCases';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import { FILTER_MODE } from '../patch/patch';
import type { Patch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import { makeArrangement } from './arrangementDocument';

/** A library patch as a version-5 song embedded it: the drive's gain inside the filter, after `resonance`. */
function formatTwo(patch: Patch): Record<string, unknown> {
  const { drive, filter, ...rest } = structuredClone(patch);
  const { mode, cutoff, resonance, ...tail } = filter;
  return { ...rest, filter: { mode, cutoff, resonance, drive: drive.gain, ...tail } };
}

const KICK_PATCH = PRESETS['kick']!;
/** A filter-off patch with a drive the old engine never played. */
const SILENT_DRIVE = { filter: { mode: FILTER_MODE.OFF, drive: 3 }, volume: 0.6 };

const versionFive = (): Record<string, unknown> => ({
  ...song([KICK], {
    patches: { ...PATCHES, kick: formatTwo(KICK_PATCH), 'drone-sqr': SILENT_DRIVE },
  }),
  version: 5,
});

const loaded = loadProcessor();
const NOTE = [{ type: 'noteOn' as const, id: 1, note: 36, velocity: 1, frame: 0 }];
const play = (patch: Patch): Float32Array =>
  render(loaded, loaded.create(patch), 200, NOTE).samples;

describe('a version-5 song (windsor#300)', () => {
  it('opens at version 6 with no correction, its drive out of the filter', () => {
    expect(ARRANGEMENT_VERSION).toBe(6);
    expect(KICK_PATCH.drive.gain).not.toBe(1); // the case is a driven patch
    const result = makeArrangement(versionFive());
    expect(result.refused).toBeUndefined();
    expect(result.corrections).toEqual([]);
    expect(result.document.version).toBe(ARRANGEMENT_VERSION);
    const patches = result.document.patches!;
    expect(patches['kick']).toEqual(KICK_PATCH);
    expect(patches['kick']!.filter).not.toHaveProperty('drive');
    // Filter Off: the old drive was silent, so the stage stays at unity, and its switch Off (windsor#309).
    expect(patches['drone-sqr']!.drive).toEqual({ on: false, gain: 1, shape: 0, bias: 0, tone: 1 });
  });

  it("renders its embedded patch bit for bit as the library's", () => {
    const embedded = makeArrangement(versionFive()).document.patches!['kick']!;
    const a = play(embedded);
    const b = play(KICK_PATCH);
    expect(Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer))).toBe(0);
  });

  it('survives export and import unchanged', () => {
    const first = makeArrangement(versionFive());
    const exported = JSON.parse(JSON.stringify(first.document)) as unknown;
    const again = makeArrangement(exported);
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('leaves an embedded patch that declares its own format to the patch table', () => {
    const declared = { ...formatTwo(KICK_PATCH), format: 2 };
    const raw = { ...versionFive(), patches: { ...PATCHES, kick: declared } };
    const result = makeArrangement(raw);
    expect(result.corrections).toEqual([]);
    expect(result.document.patches!['kick']).toEqual(KICK_PATCH);
  });
});
