/**
 * The metadata modal and the confirm modal (#563, epic #564 decision 9): the
 * page's own `<dialog>`s, never `window.confirm`. The rules — required and
 * unique name, the id from the name, categories and tags from the library —
 * are `patchMetadata.ts`; this is the markup in `index.html`
 * driven. Focus is trapped while a modal is up and returns to the patch
 * controls on close (`focusTrap.ts`), so QWERTY plays straight away.
 */
import { $, el } from './dom';
import { FocusReturn, tabWrapTarget } from './focusTrap';
import { AFTER_WRITE_COMMANDS, FOCUSABLE, NEW_CATEGORY, VOLUME_DIGITS } from './libraryConstants';
import type { LoudnessResult } from './loudnessCheck';
import type { LibraryEntries, PatchMetadata } from './patchMetadata';
import { categoriesOf, nameProblem, normaliseTags, suggestTags } from './patchMetadata';

/** Where focus lands after any modal: the patch controls' Load button, else the Parts rail. */
const patchControls = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[aria-label="Load patch"]') ??
  document.querySelector<HTMLElement>('#presetSlot button');

const focusReturn = new FocusReturn<HTMLElement>(patchControls);

/** Open a dialog with the trap installed; resolves when it closes. */
function showTrapped(dialog: HTMLDialogElement, opener: HTMLElement | null): Promise<void> {
  focusReturn.open(opener ?? (document.activeElement as HTMLElement | null));
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') return;
    const focusables = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => !node.hidden && !(node as HTMLButtonElement).disabled,
    );
    const target = tabWrapTarget(
      focusables,
      document.activeElement as HTMLElement | null,
      event.shiftKey,
    );
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };
  dialog.addEventListener('keydown', onKey);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        dialog.removeEventListener('keydown', onKey);
        focusReturn.close();
        resolve();
      },
      { once: true },
    );
    dialog.showModal();
  });
}

export interface ConfirmRequest {
  title: string;
  body: string;
  ok: string;
  opener?: HTMLElement | null;
}

/** The page's confirm: true on the OK button, false on Cancel or Escape. */
export async function openConfirm(request: ConfirmRequest): Promise<boolean> {
  const dialog = $('confirmDlg') as HTMLDialogElement;
  $('confirmTitle').textContent = request.title;
  $('confirmBody').textContent = request.body;
  const ok = $('confirmOk') as HTMLButtonElement;
  ok.textContent = request.ok;
  let answer = false;
  ok.onclick = (): void => {
    answer = true;
    dialog.close();
  };
  $('confirmCancel').onclick = (): void => dialog.close();
  const shown = showTrapped(dialog, request.opener ?? null);
  ok.focus();
  await shown;
  return answer;
}

export interface MetadataRequest {
  title: string;
  hint: string;
  initial: PatchMetadata;
  entries: LibraryEntries;
  /** Save: the fixed id. Copy to new: derived from the name as it is typed. */
  id: string | ((name: string) => string);
  /** The entry being saved over, exempt from the name-uniqueness rule. */
  ownId?: string;
  loudness: Promise<LoudnessResult> | null;
  opener?: HTMLElement | null;
}

function fillCategories(select: HTMLSelectElement, entries: LibraryEntries, current: string): void {
  const categories = categoriesOf(entries);
  if (current && !categories.includes(current)) categories.push(current);
  select.replaceChildren(
    ...categories.map((category) => new Option(category, category)),
    new Option('Add category…', NEW_CATEGORY),
  );
  select.value = current || (categories[0] ?? NEW_CATEGORY);
}

/** The chip input: chips with remove buttons, Enter or comma adds, Backspace on empty removes. */
function tagInput(entries: LibraryEntries, tags: string[]): { render: () => void } {
  const chips = $('metaTags');
  const input = $('metaTagInput') as HTMLInputElement;
  const list = $('metaTagList') as HTMLDataListElement;
  const render = (): void => {
    chips.replaceChildren(
      ...tags.map((tag) => {
        const chip = el('span', 'chip', tag);
        const remove = el('button', '', '×') as HTMLButtonElement;
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove tag ${tag}`);
        remove.onclick = (): void => {
          tags.splice(tags.indexOf(tag), 1);
          render();
          input.focus();
        };
        chip.appendChild(remove);
        return chip;
      }),
    );
  };
  const add = (): void => {
    const next = normaliseTags([...tags, ...input.value.split(',')]);
    tags.splice(0, tags.length, ...next);
    input.value = '';
    render();
  };
  input.oninput = (): void => {
    list.replaceChildren(...suggestTags(entries, input.value, tags).map((tag) => new Option(tag)));
  };
  input.onkeydown = (event): void => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && input.value === '' && tags.length) {
      tags.pop();
      render();
    }
  };
  input.onblur = add;
  return { render };
}

function loudnessLine(result: LoudnessResult, volume: number): string {
  const peak = result.peak.toFixed(VOLUME_DIGITS);
  if (!result.clips)
    return `Loudness: peak ${peak} over ${result.seeds} seeds of a 1 s note — under the line.`;
  const suggested = (result.suggestedVolume ?? 0).toFixed(VOLUME_DIGITS);
  return `Loudness: peak ${peak} at seed ${result.worstSeed} over ${result.seeds} seeds of a 1 s note — CLIPS. Suggested volume ${suggested} (now ${volume.toFixed(VOLUME_DIGITS)}). The write is still allowed; the offline sweep is the hard gate.`;
}

const afterWriteText = (): string =>
  `The written file carries a stale or missing headroom record, so npm run verify fails until you run: ${AFTER_WRITE_COMMANDS.join('; then ')}. The sweep costs about 6 s per patch at 16,384 seeds (--seeds <n> lowers it).`;

let openGeneration = 0;

/**
 * One open's claim on the loudness line (#617). The render promise is made by
 * the caller before the modal opens and resolves seconds later, so cancelling
 * and reopening inside that window used to print the previous patch's peak
 * under the new patch's title — the line was written unconditionally. Every
 * open claims the line as it builds; a writer whose open has been superseded
 * is ignored rather than allowed to overwrite the newer answer.
 */
export function claimLoudnessLine(write: (line: string) => void): (line: string) => void {
  const generation = ++openGeneration;
  return (line: string): void => {
    if (generation === openGeneration) write(line);
  };
}

/**
 * Collect the metadata for a Save or a Copy to new. Resolves the metadata on
 * Write, null on Cancel or Escape. `volume` feeds the loudness line.
 */
// eslint-disable-next-line max-lines-per-function -- one dialog, wired field by field in the order the markup shows them
export async function openMetadataModal(
  request: MetadataRequest,
  volume: number,
): Promise<PatchMetadata | null> {
  const dialog = $('metaDlg') as HTMLDialogElement;
  const name = $('metaName') as HTMLInputElement;
  const id = $('metaId') as HTMLInputElement;
  const category = $('metaCategory') as HTMLSelectElement;
  const newCategory = $('metaNewCategory') as HTMLInputElement;
  const description = $('metaDescription') as HTMLTextAreaElement;
  const problem = $('metaNameProblem');
  const loudness = $('metaLoudness');
  const tags = [...request.initial.tags];

  $('metaTitle').textContent = request.title;
  $('metaHint').textContent = request.hint;
  name.value = request.initial.name;
  fillCategories(category, request.entries, request.initial.category);
  newCategory.hidden = category.value !== NEW_CATEGORY;
  newCategory.value = '';
  description.value = request.initial.description;
  problem.textContent = '';
  $('metaAfter').textContent = afterWriteText();
  const chips = tagInput(request.entries, tags);
  chips.render();

  const syncId = (): void => {
    id.value = typeof request.id === 'string' ? request.id : request.id(name.value);
  };
  syncId();
  name.oninput = (): void => {
    problem.textContent = nameProblem(name.value, request.entries, request.ownId) ?? '';
    syncId();
  };
  category.onchange = (): void => {
    newCategory.hidden = category.value !== NEW_CATEGORY;
    if (!newCategory.hidden) newCategory.focus();
  };

  loudness.textContent = request.loudness ? 'Checking loudness…' : '';
  const showLoudness = claimLoudnessLine((line) => (loudness.textContent = line));
  request.loudness
    ?.then((result) => showLoudness(loudnessLine(result, volume)))
    .catch((error: unknown) => showLoudness(`Loudness check unavailable: ${String(error)}`));

  let answer: PatchMetadata | null = null;
  $('metaConfirm').onclick = (): void => {
    const chosenCategory =
      category.value === NEW_CATEGORY ? newCategory.value.trim() : category.value;
    const nameIssue = nameProblem(name.value, request.entries, request.ownId);
    const issue = nameIssue ?? (chosenCategory ? null : 'A category is required.');
    if (issue) {
      problem.textContent = issue;
      (nameIssue ? name : newCategory).focus();
      return;
    }
    answer = {
      name: name.value.trim(),
      category: chosenCategory,
      tags: normaliseTags(tags),
      description: description.value.trim(),
    };
    dialog.close();
  };
  $('metaCancel').onclick = (): void => dialog.close();

  const shown = showTrapped(dialog, request.opener ?? null);
  name.focus();
  name.select();
  await shown;
  return answer;
}
