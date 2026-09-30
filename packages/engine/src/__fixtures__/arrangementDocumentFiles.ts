/**
 * The JSON test songs under `arrangementDocuments/`. A current-format file
 * carries no `version`: `currentDocument` stamps `ARRANGEMENT_VERSION` on it
 * as it loads, so a format bump changes one constant and never the files
 * (record `2026-10-01-retire-song-version-3`). `rawDocument` reads a file as
 * it is, for a retired shape such as `retired-four-slot`.
 */
import { readFileSync } from 'node:fs';

import { ARRANGEMENT_VERSION } from '../audioConstants';

/** The files in the current format, which load through `currentDocument`. */
export type CurrentDocumentFile =
  'dangling-preset' | 'dangling-return' | 'nothing-usable' | 'silent-song';

/** A file under `arrangementDocuments/`, parsed and otherwise untouched. */
export function rawDocument(name: string): Record<string, unknown> {
  const url = new URL(`./arrangementDocuments/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

/** A current-format file, stamped with this build's song version. */
export function currentDocument(name: CurrentDocumentFile): Record<string, unknown> {
  return { ...rawDocument(name), version: ARRANGEMENT_VERSION };
}
