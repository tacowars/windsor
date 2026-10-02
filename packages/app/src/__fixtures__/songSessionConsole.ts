/**
 * A console with the song library attached (windsor#433): a real
 * `AppContext` over a host that accepts every live partial, the session's
 * storage in memory, and the autosave following the model as the boot
 * leaves it. `songText` makes a stored song's text.
 */
import type { ApplyResult, SongMeta } from '@windsor/engine';
import { AppContext } from '../appContext';
import type { ContextHost, TabPanel } from '../appContext';
import { DocumentModel } from '../documentModel';
import type { EngineHost } from '../host';
import { SongAutosave } from '../songAutosave';
import { songLibrary } from '../songLibrary';
import type { SongLibrary } from '../songLibrary';
import { newSong } from '../songParts';
import { followSong } from '../userSessionAutosave';
import type { MemorySessionStore, MemorySongRecords } from './memorySongStores';
import { memorySessionStore, memorySongRecords } from './memorySongStores';

/** The autosave's quiet period in these tests. */
export const DELAY_MS = 1000;

export interface SessionConsole {
  ctx: AppContext<TabPanel>;
  records: MemorySongRecords;
  store: MemorySessionStore;
  library: SongLibrary;
  autosave: SongAutosave;
  /** Every toast, as `tone: message`. */
  toasts: string[];
}

/** A song's export text: a new song with `meta` and, optionally, its own transport fields. */
export function songText(meta?: SongMeta, transport: Record<string, unknown> = {}): string {
  const raw = newSong() as Record<string, unknown>;
  const base = raw['transport'] as Record<string, unknown>;
  return new DocumentModel({ ...raw, transport: { ...base, ...transport }, meta }).toJson();
}

/** Stores another console already uses: a second tab over the same browser storage. */
export interface SharedStores {
  records: MemorySongRecords;
  store: MemorySessionStore;
}

/**
 * A console on a new untitled song, its library holding nothing, or the
 * `shared` stores of another console; `attach` false leaves it without IndexedDB.
 */
export function openSessionConsole(attach = true, shared?: SharedStores): SessionConsole {
  const toasts: string[] = [];
  const host: ContextHost = {
    apply: (): ApplyResult => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: host as EngineHost,
    model: new DocumentModel(newSong()),
    notify: (message, tone = 'info') => toasts.push(`${tone}: ${message}`),
  });
  ctx.addTab('parts', { hidden: false }, () => {});
  const store = shared?.store ?? memorySessionStore();
  const records = shared?.records ?? memorySongRecords(store);
  const library = songLibrary(records);
  const autosave = new SongAutosave({
    store,
    read: () => ctx.model.toJson(),
    report: (message) => ctx.notify(message, 'error'),
    delayMs: DELAY_MS,
  });
  if (attach) {
    ctx.songs.attach({ library, store, autosave });
    followSong(ctx.model, autosave, false);
  }
  return { ctx, records, store, library, autosave, toasts };
}
