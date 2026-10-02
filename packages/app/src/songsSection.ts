/**
 * The Songs section, first on the Settings gear tab (windsor#434, record
 * `2026-10-02-song-library`, the approved mockup
 * `docs/design/song-library-mockup.html`): the open-song strip, the filter
 * row and the table of every song stored in this browser.
 *
 * It holds no rule and no storage of its own: the list is
 * `songListModel.ts` over `ctx.songs.list()`, and every action is a call on
 * `ctx.songs` (`songSession.ts`). It draws again when the session changes
 * (a switch, a save, a write to a stored song), when the open song's name or
 * tags change (an edit or an undo), and every few seconds for the clock.
 * Without IndexedDB it is one hint line.
 */
import type { AppCtx } from './context';
import { el, html, section } from './dom';
import { songFacts } from './songFacts';
import { songFileName } from './songFileName';
import type { SongLibrary } from './songLibrary';
import type { SongListView } from './songListModel';
import {
  ALL_SONGS,
  activeFilter,
  filterChips,
  initialTags,
  sameFilter,
  songList,
  tagSuggestions,
  withOpenFacts,
} from './songListModel';
import type { SongSort } from './songListTables';
import { SONG_SORTS, SONG_TIME_REFRESH_MS } from './songListTables';
import { metaOf } from './songMetaText';
import type { SongSession } from './songSession';
import { copyName } from './songSessionStored';
import { downloadSong } from './songDownload';
import { confirmDelete, confirmLeave, openSongMeta } from './songsDialogs';
import type { RowActions } from './songRowMenu';
import { keepRowFocus, rowMenuOpen } from './songRowMenu';
import { openSongStrip } from './songsStrip';
import { songsTable } from './songsTable';

type ListEntries = Awaited<ReturnType<SongLibrary['list']>>;

/** The section's hint, the mockup's words, with the template chip inline. */
const SONGS_HINT =
  'Your songs live in this browser. A named song saves itself as you work, so switching songs ' +
  'never loses anything. Songs tagged <span class="chip template">template</span> open as a new ' +
  'untitled copy, so the template stays as it is. Export below is still how you back a song up ' +
  'or move it to another machine.';

const UNAVAILABLE_HINT =
  "Your songs need browser storage, which this browser isn't offering here. Export and Import still work.";

/** The search, filter and sort as the section edits them. */
type ListView = { -readonly [K in keyof SongListView]: SongListView[K] };

/** Kept per session, so a redraw of the tab keeps them. */
const views = new WeakMap<SongSession, ListView>();

function viewOf(songs: SongSession): ListView {
  let view = views.get(songs);
  if (!view) {
    view = { query: '', filter: ALL_SONGS, sort: 'edited' };
    views.set(songs, view);
  }
  return view;
}

/** What the library part of the section shares: the entries as last read, and the redraws. */
interface Library {
  entries: ListEntries;
  loaded: boolean;
  readonly view: ListView;
}

const openId = (ctx: AppCtx): string | null =>
  ctx.songs.state.kind === 'named' ? ctx.songs.state.id : null;

/** The entries with the open song as the document has it now. */
function liveEntries(ctx: AppCtx, lib: Library): ListEntries {
  const id = openId(ctx);
  return id === null ? lib.entries : withOpenFacts(lib.entries, id, songFacts(ctx.model.toJson()));
}

function saveDialog(ctx: AppCtx, lib: Library, copy: boolean): void {
  const meta = metaOf(ctx.model.doc);
  void openSongMeta({
    title: 'Save to your songs',
    ok: 'Save',
    name: copy ? copyName(meta.name) : meta.name,
    tags: initialTags(meta.tags, liveEntries(ctx, lib), lib.view.filter),
    suggest: (chosen) => tagSuggestions(lib.entries, chosen),
    hint: 'From now on it saves itself as you work.',
  }).then(async (answer) => {
    if (!answer) return;
    const save = copy
      ? ctx.songs.saveAsCopy(answer.name, answer.tags)
      : ctx.songs.saveAs(answer.name, answer.tags);
    if ((await save) !== null) ctx.notify(`saved ${answer.name} to your songs`, 'success');
  });
}

/** Leave the open song for another, asking first only when that would lose something. */
function leaveFor(ctx: AppCtx, opener: HTMLElement, go: () => Promise<boolean>): void {
  void confirmLeave(ctx, opener).then((ok) => ok && go());
}

function rowActions(ctx: AppCtx, lib: Library): RowActions {
  return {
    open: (row, opener) => leaveFor(ctx, opener, () => ctx.songs.open(row.id)),
    newFrom: (row, opener) => leaveFor(ctx, opener, () => ctx.songs.newFrom(row.id)),
    rename: (row, opener) =>
      void openSongMeta({ title: 'Rename song', ok: 'Rename', name: row.name, opener }).then(
        (answer) => answer && ctx.songs.rename(row.id, answer.name),
      ),
    editTags: (row, opener) =>
      void openSongMeta({
        title: 'Edit tags',
        ok: 'Save',
        tags: row.tags,
        opener,
        suggest: (chosen) => tagSuggestions(lib.entries, chosen),
      }).then((answer) => answer && ctx.songs.setTags(row.id, answer.tags)),
    duplicate: (row) =>
      void ctx.songs.duplicate(row.id).then((id) => {
        if (id !== null) ctx.notify(`duplicated ${row.name}`, 'success');
      }),
    exportJson: (row) =>
      void ctx.songs.exportText(row.id).then((text) => {
        if (text === null) return;
        const fileName = songFileName(row.name);
        downloadSong(text, fileName);
        ctx.notify(`exported ${fileName}`, 'success');
      }),
    remove: (row, opener) =>
      void confirmDelete(row.name, opener).then(async (ok) => {
        if (ok && (await ctx.songs.remove(row.id))) ctx.notify(`deleted ${row.name}`, 'success');
      }),
  };
}

function searchField(view: Library['view'], paint: () => void): HTMLInputElement {
  const search = document.createElement('input');
  search.className = 'field search';
  search.name = 'song-search';
  search.type = 'search';
  search.placeholder = 'Search songs';
  search.autocomplete = 'off';
  search.setAttribute('aria-label', 'Search songs');
  search.value = view.query;
  search.oninput = (): void => {
    view.query = search.value;
    paint();
  };
  return search;
}

function sortSelect(view: Library['view'], paint: () => void): HTMLSelectElement {
  const sort = document.createElement('select');
  sort.className = 'field';
  sort.name = 'song-sort';
  sort.setAttribute('aria-label', 'Sort');
  for (const option of SONG_SORTS) sort.add(new Option(option.label, option.value));
  sort.value = view.sort;
  sort.onchange = (): void => {
    view.sort = sort.value as SongSort;
    paint();
  };
  return sort;
}

function chipButtons(
  entries: ListEntries,
  view: Library['view'],
  paint: () => void,
): HTMLElement[] {
  const active = activeFilter(entries, view.filter);
  return filterChips(entries).map((chip) => {
    const on = sameFilter(chip.filter, active);
    const b = el(
      'button',
      `chip filter-chip${chip.template ? ' template' : ''}${on ? ' on' : ''}`,
      chip.label,
    );
    (b as HTMLButtonElement).type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.onclick = (): void => {
      view.filter = chip.filter;
      paint();
    };
    return b;
  });
}

/** The library: hint, strip, filter row and table, and the redraws that keep them current. */
function librarySection(
  ctx: AppCtx,
  alive: () => boolean,
): { nodes: HTMLElement[]; refresh: () => void; tick: () => void; metaChanged: () => void } {
  const lib: Library = { entries: [], loaded: false, view: viewOf(ctx.songs) };
  const strip = openSongStrip(
    ctx,
    { saveAs: () => saveDialog(ctx, lib, false), saveAsCopy: () => saveDialog(ctx, lib, true) },
    () => lib.entries.find((entry) => entry.id === openId(ctx))?.updated ?? null,
  );
  const chips = el('span', 'chips');
  const count = el('span', 'count');
  const table = el('div', 'table-wrap');
  const actions = rowActions(ctx, lib);
  const paint = (): void => {
    if (!lib.loaded) return;
    const entries = liveEntries(ctx, lib);
    const list = songList(entries, lib.view, { openId: openId(ctx), now: new Date() });
    chips.replaceChildren(...chipButtons(entries, lib.view, paint));
    count.textContent = `${list.shown} of ${list.total}`;
    keepRowFocus(table, () => table.replaceChildren(songsTable(list, actions)));
    table.classList.toggle('bare', list.total === 0);
  };
  const filters = el('div', 'filters');
  filters.append(searchField(lib.view, paint), chips, sortSelect(lib.view, paint), count);
  let reads = 0;
  const refresh = (): void => {
    const read = ++reads;
    void ctx.songs.list().then((entries) => {
      if (read !== reads || !alive()) return;
      lib.entries = entries;
      lib.loaded = true;
      strip.update();
      paint();
    });
  };
  const tick = (): void => {
    strip.update();
    if (!rowMenuOpen()) paint();
  };
  const metaChanged = (): void => {
    strip.update();
    paint();
  };
  return {
    nodes: [html('p', 'hint', SONGS_HINT), strip.root, filters, table],
    refresh,
    tick,
    metaChanged,
  };
}

export function songsSection(ctx: AppCtx): HTMLElement {
  const { root, body } = section('Songs');
  root.classList.add('songs');
  const stops: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = (): boolean => {
    if (root.isConnected) return true;
    stops.forEach((stop) => stop());
    clearTimeout(timer);
    return false;
  };
  let shown: boolean | null = null;
  let library: ReturnType<typeof librarySection> | null = null;
  const draw = (): void => {
    if (shown === ctx.songs.available) return library?.refresh();
    shown = ctx.songs.available;
    library = shown ? librarySection(ctx, alive) : null;
    body.replaceChildren(...(library ? library.nodes : [el('p', 'hint', UNAVAILABLE_HINT)]));
    library?.refresh();
  };
  let meta = JSON.stringify(metaOf(ctx.model.doc));
  stops.push(
    ctx.songs.onChange(() => {
      if (alive()) draw();
    }),
    ctx.model.onChange(() => {
      const next = JSON.stringify(metaOf(ctx.model.doc));
      if (next === meta || !alive()) return;
      meta = next;
      library?.metaChanged();
    }),
  );
  const tick = (): void => {
    if (!alive()) return;
    library?.tick();
    timer = setTimeout(tick, SONG_TIME_REFRESH_MS);
  };
  timer = setTimeout(tick, SONG_TIME_REFRESH_MS);
  draw();
  return root;
}
