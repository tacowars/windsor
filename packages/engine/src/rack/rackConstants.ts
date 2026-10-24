/**
 * The rack file's fixed values (windsor#862, record `2026-10-17-racks`
 * decisions 6 and 7): its format number, the `kind` that tells it from a
 * patch file, and its keys in the order the serialiser writes them.
 */

/**
 * The rack file format this build reads and writes. 1 is the first; 2
 * (windsor#935) dropped the Grid's and the Arp's `skipChance`, upgraded by
 * `RACK_MIGRATIONS[1]`; 3 (windsor#945) changed what a varied step plays and
 * added the Grid's and the Arp's `chancePerEffect`, written off by
 * `RACK_MIGRATIONS[2]`.
 */
export const RACK_FILE_FORMAT = 3;

/** The `kind` every rack file carries; a file without one is a patch file. */
export const RACK_FILE_KIND = 'rack';

/** The keys every rack file carries, in file order. */
export const RACK_FILE_REQUIRED = [
  'format',
  'kind',
  'name',
  'category',
  'tags',
  'description',
  'patchFormat',
  'patch',
  'inserts',
] as const;

/** The keys a rack file may carry: absent leaves the loaded part's own value. */
export const RACK_FILE_OPTIONAL = ['patchSource', 'lowCut', 'sequencer'] as const;

/** Every key in the order the serialiser writes them. */
export const RACK_FILE_KEYS = [
  'format',
  'kind',
  'name',
  'category',
  'tags',
  'description',
  'patchFormat',
  'patch',
  'patchSource',
  'lowCut',
  'sequencer',
  'inserts',
] as const;
