/**
 * The Songs section's questions (windsor#434, mockup
 * `docs/design/song-library-mockup.html`): one name-and-tags dialog for
 * Save as…, Save as copy…, Rename… and Edit tags…, the delete confirm, and
 * the question before leaving a changed untitled song. The dialogs use the
 * console's `dialog` styling; the confirms are the page's own `openConfirm`.
 */
import type { AppCtx } from './context';
import { el } from './dom';
import { openConfirm, showTrapped } from './metadataModal';
import { addTags, isTemplate } from './songListModel';

/** What the name-and-tags dialog asks: a field is shown only when it is given. */
export interface SongMetaRequest {
  readonly title: string;
  readonly ok: string;
  readonly name?: string;
  readonly tags?: readonly string[];
  /** The tags offered under the field, given the ones chosen so far. */
  readonly suggest?: (chosen: readonly string[]) => string[];
  readonly hint?: string;
  /**
   * Where focus returns on close. A row menu passes the row's ⋯ button, since
   * the menu item that was clicked is gone by the time the dialog closes.
   */
  readonly opener?: HTMLElement | null;
}

export interface SongMetaAnswer {
  readonly name: string;
  readonly tags: readonly string[];
}

const DIALOG_ID = 'songMetaDlg';

/** A tag chip, in the template colour for `template`. */
export function tagChip(tag: string): HTMLElement {
  return el('span', isTemplate({ tags: [tag] }) ? 'chip template' : 'chip', tag);
}

/** A chip with a × that calls `remove`. */
export function removableChip(tag: string, remove: () => void): HTMLElement {
  const chip = tagChip(tag);
  const button = el('button', '', '×') as HTMLButtonElement;
  button.type = 'button';
  button.setAttribute('aria-label', `Remove tag ${tag}`);
  button.onclick = remove;
  chip.appendChild(button);
  return chip;
}

function button(label: string, className: string, type: 'button' | 'submit'): HTMLButtonElement {
  const b = el('button', className, label) as HTMLButtonElement;
  b.type = type;
  return b;
}

/** The dialog element, made once and kept in the page. */
function songDialog(): HTMLDialogElement {
  const found = document.getElementById(DIALOG_ID);
  if (found instanceof HTMLDialogElement) return found;
  const dialog = document.createElement('dialog');
  dialog.id = DIALOG_ID;
  dialog.className = 'song-dlg';
  document.body.appendChild(dialog);
  return dialog;
}

/** The chip entry: the chosen tags with ×, a text field, and the suggestions to click. */
function tagField(
  tags: string[],
  suggest: (chosen: readonly string[]) => string[],
): { field: HTMLElement; offered: HTMLElement } {
  const field = el('div', 'tag-input');
  const offered = el('div', 'suggest');
  const input = document.createElement('input');
  input.name = 'song-tag';
  input.placeholder = 'add a tag…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'Add a tag');
  const paint = (): void => {
    const chips = tags.map((tag) =>
      removableChip(tag, () => {
        tags.splice(tags.indexOf(tag), 1);
        paint();
        input.focus();
      }),
    );
    field.replaceChildren(...chips, input);
    offered.replaceChildren(
      ...suggest(tags).map((tag) => {
        const chip = tagChip(tag);
        chip.onclick = (): void => {
          tags.push(tag);
          paint();
        };
        return chip;
      }),
    );
  };
  const add = (): void => {
    tags.splice(0, tags.length, ...addTags(tags, input.value));
    input.value = '';
    paint();
    input.focus();
  };
  input.onkeydown = (event): void => {
    if ((event.key === 'Enter' && input.value.trim() !== '') || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && input.value === '' && tags.length > 0) {
      tags.pop();
      paint();
    }
  };
  input.onblur = (): void => {
    if (input.value.trim() !== '') add();
  };
  paint();
  return { field, offered };
}

function labelled(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('label');
  wrap.append(el('span', 'field-label', label), control);
  return wrap;
}

/** Ask for a name and tags; resolves them on the OK button (or Enter), null on Cancel or Escape. */
export function openSongMeta(request: SongMetaRequest): Promise<SongMetaAnswer | null> {
  const dialog = songDialog();
  const form = document.createElement('form');
  form.method = 'dialog';
  form.className = 'dlg-body';
  form.appendChild(el('div', 'dlg-title', request.title));
  const name = document.createElement('input');
  name.className = 'field';
  name.name = 'song-name';
  name.autocomplete = 'off';
  name.value = request.name ?? '';
  if (request.name !== undefined) form.appendChild(labelled('Name', name));
  const tags = [...(request.tags ?? [])];
  if (request.tags !== undefined) {
    const { field, offered } = tagField(tags, request.suggest ?? ((): string[] => []));
    const box = el('div');
    box.append(el('span', 'field-label', 'Tags'), field);
    form.append(box, offered);
  }
  if (request.hint) form.appendChild(el('p', 'hint', request.hint));
  const ok = button(request.ok, 'btn primary', 'submit');
  const cancel = button('Cancel', 'btn', 'button');
  const actions = el('div', 'dlg-actions');
  actions.append(cancel, ok);
  form.appendChild(actions);
  const named = (): boolean => request.name === undefined || name.value.trim() !== '';
  name.oninput = (): void => void (ok.disabled = !named());
  ok.disabled = !named();
  dialog.replaceChildren(form);
  let answer: SongMetaAnswer | null = null;
  form.onsubmit = (): void => {
    if (named()) answer = { name: name.value.trim(), tags: [...tags] };
  };
  cancel.onclick = (): void => dialog.close();
  const shown = showTrapped(dialog, request.opener ?? null);
  (request.name !== undefined ? name : (form.querySelector('input') ?? ok)).focus();
  return shown.then(() => answer);
}

/** Delete asks first, in the mockup's words; the OK button is drawn as a danger. */
export async function confirmDelete(name: string, opener: HTMLElement | null): Promise<boolean> {
  const ok = document.getElementById('confirmOk');
  ok?.classList.add('danger');
  try {
    return await openConfirm({
      title: 'Delete song',
      body: `Delete “${name}” from this browser? This can't be undone. Export it first to keep a copy.`,
      ok: 'Delete',
      opener,
    });
  } finally {
    ok?.classList.remove('danger');
  }
}

/** The words before leaving a changed untitled song, while your songs are there to save it in. */
export const LEAVE_UNTITLED_TEXT =
  'Discard the changes to this untitled song? Save as… first to keep it.';

/** Leaving the open song (Open, New from, New song): asks only when it would lose something. */
export async function confirmLeave(ctx: AppCtx, opener: HTMLElement | null): Promise<boolean> {
  if (!ctx.songs.leaveNeedsConfirm()) return true;
  return openConfirm({
    title: 'Discard changes',
    body: ctx.songs.available
      ? LEAVE_UNTITLED_TEXT
      : 'Discard the changes to this song? Export first to keep them.',
    ok: 'Discard',
    opener,
  });
}
