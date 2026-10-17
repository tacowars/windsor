/**
 * The full-pane browser's results table (windsor#522): a patch row of Name,
 * Category, Tags and Source, and, on Racks (windsor#884, record
 * `2026-10-17-racks` decision 18), a rack row with its Chain line between
 * Category and Tags, the kinds' labels joined by → and the pattern mark ▦
 * with the sequencer kind's label when the rack carries one.
 */
import type { PresetListing } from '@windsor/engine';
import { el } from './dom';
import { ROW_SOURCE_LABELS } from './patchLibrary';
import type { RackRow } from './rackBrowserModel';
import { KIND_LABELS } from './sequencerConstants';

const PATTERN_MARK = '▦';

function table(columns: readonly string[]): {
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const node = document.createElement('table');
  node.className = 'pb-table';
  const head = document.createElement('tr');
  for (const name of columns) head.appendChild(el('th', '', name));
  node.createTHead().appendChild(head);
  return { table: node, body: node.createTBody() };
}

/** The patches' table. */
export function resultsTable(rows: readonly PresetListing[]): HTMLTableElement {
  const { table: node, body } = table(['Name', 'Category', 'Tags', 'Source']);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.append(
      el('td', '', row.name),
      el('td', '', row.category),
      el('td', '', row.tags.join(', ')),
      el('td', '', ROW_SOURCE_LABELS[row.source]),
    );
    body.appendChild(tr);
  }
  return node;
}

/** A rack row's Chain cell: the labels with → between them, then the pattern mark. */
function chainCell(row: RackRow): HTMLElement {
  const cell = el('td', '');
  const chain = el('span', 'pb-chain');
  row.chain.forEach((label, i) => {
    if (i > 0) chain.appendChild(el('span', 'arrow', '→'));
    chain.appendChild(el('span', '', label));
  });
  cell.appendChild(chain);
  if (row.pattern !== null) {
    const mark = el('span', 'pb-pattern');
    mark.title = `Carries a ${KIND_LABELS[row.pattern]} pattern`;
    mark.append(el('span', 'glyph', PATTERN_MARK), KIND_LABELS[row.pattern]);
    cell.appendChild(mark);
  }
  return cell;
}

/** The racks' table. */
export function rackTable(rows: readonly RackRow[]): HTMLTableElement {
  const { table: node, body } = table(['Name', 'Category', 'Chain', 'Tags', 'Source']);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.dataset.id = row.id;
    tr.append(
      el('td', '', row.name),
      el('td', '', row.category),
      chainCell(row),
      el('td', '', row.tags.join(', ')),
      el('td', '', ROW_SOURCE_LABELS[row.source]),
    );
    body.appendChild(tr);
  }
  return node;
}
