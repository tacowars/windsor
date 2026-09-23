/**
 * The patches game code plays, by stable library id (epic #564 decision 3).
 *
 * `GAMEPLAY_PATCH_IDS` is the single table: game code imports its ids from
 * here rather than spelling them, `gameplayPatches.test.ts` fails when a listed
 * id has no `patches/<id>.json`, and the editor's Delete guard (#563) refuses
 * an id this table names. Each patch is a static import of its own file, so a
 * bundler keeps only these once #562 stops the game importing `PRESETS`.
 */
import type { Patch } from './patch';
import { loadPatchFile } from './patchLibrary';
import pickupBlip from '../patches/pickup-blip.json';
import weaponZap from '../patches/weapon-zap.json';

export const GAMEPLAY_PATCH_IDS = {
  /** The player's weapon bolt, baked once by `sfxBuffers.ts`. */
  weaponZap: 'weapon-zap',
  /** The pickup blip: baked by `sfxBuffers.ts` and the fallback click's voice in `arrangement.ts`. */
  pickupBlip: 'pickup-blip',
} as const;

export type GameplayPatchId = (typeof GAMEPLAY_PATCH_IDS)[keyof typeof GAMEPLAY_PATCH_IDS];

const FILES: Readonly<Record<GameplayPatchId, unknown>> = {
  'weapon-zap': weaponZap,
  'pickup-blip': pickupBlip,
};

/** The gameplay patches, validated from their own files. */
export const GAMEPLAY_PATCHES: Readonly<Record<GameplayPatchId, Patch>> = Object.fromEntries(
  Object.values(GAMEPLAY_PATCH_IDS).map((id) => [id, loadPatchFile(id, FILES[id]).patch]),
) as Record<GameplayPatchId, Patch>;
