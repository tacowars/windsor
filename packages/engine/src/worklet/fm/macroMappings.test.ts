/**
 * The one rule for which macro mappings stand (windsor#560): the main
 * thread's predicate, `macroMapsTarget`, answers from the same list the
 * worklet's `normalisePatch` keeps, so a direct lane is inert exactly where
 * the voice maps its target. A document's patch (`makePatch`) may hold more
 * than the voice keeps; the predicate follows the voice.
 */
import { describe, expect, it } from 'vitest';

import { makePatch, type PartialPatch } from '../../patch/patch';
import { macroMapsTarget } from './macroMappings';
import { MACRO_MAPPINGS_MAX } from './patchDefaults';
import { isMacroCode, VOICE_TARGET_PATHS } from './voiceTargetTables';

// `waveTables` warms the wave cache at load and reads the scope's sample rate.
Object.assign(globalThis, { sampleRate: 48000 });
const { normalisePatch } = await import('./patchNormalise');

const TARGETS = VOICE_TARGET_PATHS.filter((_, code) => !isMacroCode(code));

/** Every voice target the worklet's normalised patch maps. */
const voiceMapped = (patch: PartialPatch): string[] =>
  normalisePatch(patch)
    .macros.flatMap((macro) => macro.mappings.map((m) => m.target))
    .sort();

/** Every voice target the main thread's predicate calls mapped. */
const predicateMapped = (patch: PartialPatch): string[] =>
  VOICE_TARGET_PATHS.filter((path) => macroMapsTarget(patch, path)).sort();

describe('the mappings the voice applies (windsor#560)', () => {
  it('leaves a ninth mapping on a valid target unmapped, on both sides', () => {
    const ninth = TARGETS[MACRO_MAPPINGS_MAX]!;
    const mappings = TARGETS.slice(0, MACRO_MAPPINGS_MAX + 1).map((target) => ({ target }));
    const patch = makePatch({ macros: [{ mappings }] } as PartialPatch);
    expect(patch.macros[0]!.mappings.map((m) => m.target)).toContain(ninth);
    expect(macroMapsTarget(patch, ninth)).toBe(false);
    expect(voiceMapped(patch)).not.toContain(ninth);
    expect(predicateMapped(patch)).toEqual(voiceMapped(patch));
  });

  it('keeps the first of a mapping repeated across two macros, on both sides', () => {
    const patch = makePatch({
      macros: [
        { mappings: [{ target: 'filter.cutoff' }] },
        { mappings: [{ target: 'filter.cutoff' }, { target: 'ops.1.level' }] },
      ],
    } as PartialPatch);
    const [first, second] = normalisePatch(patch).macros;
    expect(first!.mappings.map((m) => m.target)).toEqual(['filter.cutoff']);
    expect(second!.mappings.map((m) => m.target)).toEqual(['ops.1.level']);
    expect(predicateMapped(patch)).toEqual(voiceMapped(patch));
  });
});
