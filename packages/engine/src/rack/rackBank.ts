/**
 * The built-in rack bank (windsor#877, record `2026-10-17-racks` decision
 * 16): every `racks/<id>.json`, loaded through the one rack loader when this
 * module is imported, so a file the loader refuses fails the bank's test and
 * the build, as a malformed patch fails `presets.ts`. A soft correction (a
 * clamp, a dropped key) stays on its entry's `problems`. The console never
 * imports this module: `builtInRacks.ts` loads it on demand as its own chunk.
 */
import { RACK_FILES } from '../racks/index';
import type { BuiltInRacks } from './builtInRacks';
import { loadRackFile } from './rackFile';

/** Every file of a bank through the loader, keyed by id; throws on the first refusal. */
export function loadRackBank(files: Readonly<Record<string, unknown>>): BuiltInRacks {
  return Object.fromEntries(Object.entries(files).map(([id, raw]) => [id, loadRackFile(id, raw)]));
}

/** The shipped bank, validated. */
export const RACK_BANK: BuiltInRacks = loadRackBank(RACK_FILES);
