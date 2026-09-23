/**
 * Every committed `arrangements/*.json`, bundled at build time and keyed by
 * file name — the same `import.meta.glob` idiom `terrain/splatTextures.ts`
 * uses, and still no runtime fetch: a malformed document fails the build and
 * an unknown name fails loudly (record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §3, kept by
 * `2026-09-11-music-document-carries-patches-and-returns`).
 *
 * `?music=<name>` picks one (`musicOptions.ts`); the default is
 * `DEFAULT_ARRANGEMENT_NAME`. Dropping a console export into the folder is
 * the whole workflow for auditioning a piece: no code names the file.
 *
 * Vite-only, by the glob: the arrangement console bundles through
 * `index-for-editor.ts`, which must not export this module.
 */
import { DEFAULT_ARRANGEMENT_NAME } from '../audioConstants';
import { musicDocumentFromQuery, musicEnabledFromQuery } from './musicOptions';

const DOCUMENTS = import.meta.glob<unknown>('../arrangements/*.json', {
  eager: true,
  import: 'default',
});

/** The committed documents, raw (not yet normalised), by file name without `.json`. */
export const ARRANGEMENT_LIBRARY: Readonly<Record<string, unknown>> = Object.fromEntries(
  Object.entries(DOCUMENTS).map(([path, raw]) => [
    path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, ''),
    raw,
  ]),
);

export const ARRANGEMENT_NAMES = Object.keys(ARRANGEMENT_LIBRARY).sort();

/** What `installMusicControls` plays: the selection the query string made. */
export interface MusicSelection {
  /** False under `?music=0`: the graph is built, the transport never starts. */
  readonly enabled: boolean;
  /** The document name asked for (or the default). */
  readonly name: string;
  /** Its raw document — `undefined` when no committed file has that name. */
  readonly raw: unknown;
}

/** Resolve the page's query string against the library. */
export function selectMusic(search: string, library = ARRANGEMENT_LIBRARY): MusicSelection {
  const name = musicDocumentFromQuery(search) ?? DEFAULT_ARRANGEMENT_NAME;
  return { enabled: musicEnabledFromQuery(search), name, raw: library[name] };
}
