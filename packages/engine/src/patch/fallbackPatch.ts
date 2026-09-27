/**
 * The one patch the engine itself names: the voice of the fallback click
 * (`song/fallbackArrangement.ts`). Everything else the engine plays arrives
 * as a `Patch` from its caller or from a song's own `patches` (#562).
 *
 * The id is spelled here and nowhere else in engine code;
 * `fallbackPatch.test.ts` fails when it has no `patches/<id>.json` or when
 * another engine file spells a preset id, and the console's Delete guard
 * (#563) refuses it. The file is a static import of its own, so a bundler
 * needs none of the rest of the library to play the fallback.
 */
import type { Patch } from './patch';
import { loadPatchFile } from './patchLibrary';
import pickupBlip from '../patches/pickup-blip.json';

/** A short sine blip with a rising pitch envelope. */
export const FALLBACK_PATCH_ID = 'pickup-blip';

/** The fallback click's patch, validated from its own file. */
export const FALLBACK_PATCH: Patch = loadPatchFile(FALLBACK_PATCH_ID, pickupBlip).patch;
