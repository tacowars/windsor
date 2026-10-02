/**
 * The Songs section's table (windsor#434 decision 3, mockup
 * `docs/design/song-library-mockup.html`): Name, Tags, BPM, Meter, Bars,
 * Key and Edited, then the row's actions. The open song's row is marked
 * `open` and has no Open button; a template's action is New from; a song
 * this build can't open shows its refusal and only the ⋯ menu.
 */
import { el, html } from './dom';
import type { SongList, SongRow } from './songListModel';
import type { RowActions } from './songRowMenu';
import { rowMenuButton } from './songRowMenu';
import { tagChip } from './songsDialogs';

const COLUMNS = ['Name', 'Tags', 'BPM', 'Meter', 'Bars', 'Key', 'Edited', ''];

/** The empty library's words, the mockup's, with the template chip inline. */
const EMPTY_LIBRARY =
  'No songs yet. Give this one a name with <b>Save as…</b> and it shows up here.<br>' +
  'Tag one <span class="chip template">template</span> to start new songs from it.';

function cell(className: string, text: string): HTMLElement {
  return el('td', className, text);
}

function smallButton(label: string, onPress: (b: HTMLElement) => void, title = ''): HTMLElement {
  const b = el('button', 'btn small', label) as HTMLButtonElement;
  b.type = 'button';
  if (title) b.title = title;
  b.onclick = (): void => onPress(b);
  return b;
}

function nameCell(row: SongRow): HTMLElement {
  const td = el('td');
  td.appendChild(el('span', 'name', row.name));
  if (row.open) td.appendChild(el('span', 'now-open', 'open'));
  if (row.refusal !== null) td.appendChild(el('span', 'refused', `can't open: ${row.refusal}`));
  return td;
}

function actionsCell(row: SongRow, actions: RowActions): HTMLElement {
  const td = el('td', 'acts');
  const wrap = el('span', 'wrap');
  if (row.refusal === null && row.template) {
    const hint = 'Start a new untitled song from this template';
    wrap.appendChild(smallButton('New from', (b) => actions.newFrom(row, b), hint));
  } else if (row.refusal === null && !row.open) {
    wrap.appendChild(smallButton('Open', (b) => actions.open(row, b)));
  }
  wrap.appendChild(rowMenuButton(row, actions));
  td.appendChild(wrap);
  return td;
}

function tableRow(row: SongRow, actions: RowActions): HTMLElement {
  const tr = el('tr', row.open ? 'is-open' : '');
  const tags = el('span', 'chips');
  tags.append(...row.tags.map(tagChip));
  const tagCell = el('td');
  tagCell.appendChild(tags);
  tr.append(
    nameCell(row),
    tagCell,
    cell('num', row.bpm),
    cell('num', row.meter),
    cell('num', row.bars),
    cell('num', row.key),
    cell('when', row.edited),
    actionsCell(row, actions),
  );
  return tr;
}

/** The table for `list`, or the empty library's words when there is no song at all. */
export function songsTable(list: SongList, actions: RowActions): HTMLElement {
  if (list.total === 0) return html('div', 'empty', EMPTY_LIBRARY);
  const table = el('table', 'song-table');
  const head = el('tr');
  head.append(...COLUMNS.map((title) => el('th', '', title)));
  const thead = el('thead');
  thead.appendChild(head);
  const body = el('tbody');
  if (list.rows.length === 0) {
    const none = el('td', 'empty', 'No song matches.');
    none.setAttribute('colspan', String(COLUMNS.length));
    const tr = el('tr');
    tr.appendChild(none);
    body.appendChild(tr);
  }
  body.append(...list.rows.map((row) => tableRow(row, actions)));
  table.append(thead, body);
  return table;
}
