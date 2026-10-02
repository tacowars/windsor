/**
 * The open-song strip at the top of the Songs section (windsor#434
 * decision 2, mockup `docs/design/song-library-mockup.html`).
 *
 * - **A named song:** its name is an inline field, a commit renames it; its
 *   tags are chips with × and a `+ tag` chip. Both are document edits, so
 *   the header's undo covers them. The status reads `saved · <when>`, and
 *   the button is Save as copy….
 * - **An untitled song:** `Untitled` (or `Untitled — from <template>`), the
 *   status `not in your songs · kept only as your last session`, and Save
 *   as… as the primary button.
 *
 * The strip is drawn again only when what it shows changed, and never under
 * a field being typed in.
 */
import type { SongMeta } from '@windsor/engine';
import type { AppCtx } from './context';
import { el } from './dom';
import { addTags, relativeTime, UNTITLED } from './songListModel';
import { metaOf } from './songMetaText';
import type { SongSessionState } from './songSession';
import { removableChip } from './songsDialogs';

/** What the strip's buttons open: the section's dialogs. */
export interface StripActions {
  saveAs(opener: HTMLElement): void;
  saveAsCopy(opener: HTMLElement): void;
}

/** When the open named song was last written, from its list entry; null before the list has loaded. */
export type UpdatedAt = () => string | null;

export interface OpenSongStrip {
  readonly root: HTMLElement;
  /** Draw what changed: the song, its name and tags, or only the status's clock. */
  update(): void;
}

function statusLine(text: string, saved: boolean): HTMLElement {
  const line = el('span', saved ? 'saved' : 'saved unsaved');
  line.append(el('span', 'dot'), document.createTextNode(text));
  return line;
}

function stripButton(
  label: string,
  className: string,
  onPress: (b: HTMLElement) => void,
): HTMLElement {
  const b = el('button', className, label) as HTMLButtonElement;
  b.type = 'button';
  b.onclick = (): void => onPress(b);
  return b;
}

/** The name field: Enter commits, Escape puts it back, an empty name is refused. */
function nameField(ctx: AppCtx, id: string, name: string): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'song-name';
  input.name = 'open-song-name';
  input.autocomplete = 'off';
  input.value = name;
  input.setAttribute('aria-label', 'Song name — click to rename');
  input.onkeydown = (event): void => {
    if (event.key === 'Escape') input.value = name;
    if (event.key === 'Enter' || event.key === 'Escape') input.blur();
  };
  input.onchange = (): void => {
    const next = input.value.trim();
    if (next === '' || next === name) input.value = name;
    else void ctx.songs.rename(id, next);
  };
  return input;
}

/** The `+ tag` chip, which turns into a field while a tag is typed. */
function addTagChip(ctx: AppCtx, id: string, tags: readonly string[]): HTMLElement {
  const chip = el('span', 'chip add', '+ tag');
  chip.tabIndex = 0;
  chip.setAttribute('role', 'button');
  const edit = (): void => {
    const input = document.createElement('input');
    input.className = 'chip add tag-entry';
    input.name = 'open-song-tag';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Add a tag');
    let done = false;
    const finish = (keep: boolean): void => {
      if (done) return;
      done = true;
      const next = addTags(tags, input.value);
      if (keep && next.length > tags.length) {
        // Let go of the field, so the strip can draw the new chip.
        input.blur();
        void ctx.songs.setTags(id, next);
      } else input.replaceWith(chip);
    };
    input.onkeydown = (event): void => {
      if (event.key === 'Enter') finish(true);
      if (event.key === 'Escape') finish(false);
    };
    input.onblur = (): void => finish(true);
    chip.replaceWith(input);
    input.focus();
  };
  chip.onclick = edit;
  chip.onkeydown = (event): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      edit();
    }
  };
  return chip;
}

function namedParts(ctx: AppCtx, id: string, meta: SongMeta): HTMLElement[] {
  const chips = el('span', 'chips');
  for (const tag of meta.tags) {
    chips.appendChild(
      removableChip(
        tag,
        () =>
          void ctx.songs.setTags(
            id,
            meta.tags.filter((t) => t !== tag),
          ),
      ),
    );
  }
  chips.appendChild(addTagChip(ctx, id, meta.tags));
  return [nameField(ctx, id, meta.name), chips];
}

/**
 * An untitled song reads `Untitled` even when its document carries a name
 * (an import, or the open song just deleted): that name is what Save as…
 * offers and what the export file is called.
 */
function untitledName(state: SongSessionState): string {
  return state.kind === 'untitled' && state.origin !== undefined
    ? `${UNTITLED} — from ${state.origin}`
    : UNTITLED;
}

function status(ctx: AppCtx, updated: UpdatedAt): HTMLElement {
  if (ctx.songs.state.kind === 'untitled')
    return statusLine('not in your songs · kept only as your last session', false);
  if (ctx.songs.stale) return statusLine('not saved · this song was changed in another tab', false);
  const when = updated();
  return statusLine(when === null ? 'saved' : `saved · ${relativeTime(when, new Date())}`, true);
}

export function openSongStrip(
  ctx: AppCtx,
  actions: StripActions,
  updated: UpdatedAt,
): OpenSongStrip {
  const root = el('div', 'open-song');
  let drawn = '';
  let line: HTMLElement = el('span');

  const draw = (): void => {
    const { state } = ctx.songs;
    const meta = metaOf(ctx.model.doc);
    const named = state.kind === 'named';
    root.classList.toggle('untitled', !named);
    line = status(ctx, updated);
    const label = el('span', 'field-label', 'Open');
    const parts = named
      ? namedParts(ctx, state.id, meta)
      : [el('span', 'song-name placeholder', untitledName(state))];
    const action = named
      ? stripButton('Save as copy…', 'btn', (b) => actions.saveAsCopy(b))
      : stripButton('Save as…', 'btn primary', (b) => actions.saveAs(b));
    root.replaceChildren(label, ...parts, el('span', 'spacer'), line, action);
  };

  const update = (): void => {
    const signature = JSON.stringify([ctx.songs.state, metaOf(ctx.model.doc)]);
    const typing =
      document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement);
    if (signature !== drawn && !typing) {
      drawn = signature;
      draw();
      return;
    }
    const next = status(ctx, updated);
    line.replaceWith(next);
    line = next;
  };

  update();
  return { root, update };
}
