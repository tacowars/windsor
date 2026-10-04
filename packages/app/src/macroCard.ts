/**
 * The Parts tab's Macros card (windsor#561, record
 * `2026-10-04-patch-macro-knobs` decision 11), drawn to the approved mockup
 * `docs/design/macro-knobs-mockup.html`, layout A: the deck's last card, at
 * its full width. A row of tiles, one per macro (its name, its value knob, its
 * mapping count, `×`), a `+` tile, then the selected macro's mappings, each a
 * row of target, Min, Max, curve, Invert and `×`, and `+ Add mapping` with
 * its target picker.
 *
 * The rules are `macroModel.ts`; this file only wires. Every edit writes the
 * whole `macros` list into the working patch and pushes it (`PatchEditor`),
 * the way every other Parts-tab control commits. Which macro is selected is
 * the session's, not the patch's.
 */
import type { Macro, VoiceAutomationRow, VoiceTargetPath } from '@windsor/engine';
import {
  MACRO_CURVE_NAMES,
  MACRO_MAPPINGS_MAX,
  MACROS_MAX,
  VOICE_AUTOMATION_ROWS,
  makeMacro,
  requireCatalogRow,
  voiceTargetId,
} from '@windsor/engine';
import { readout } from './automationReadout';
import { CARRIER_COLOR, MOD_COLOR } from './consoleColors';
import { $, el, seg } from './dom';
import { makeKnob, relabelKnob } from './knob';
import type { KnobAutomation } from './knobAutomation';
import { followAutomation } from './knobLock';
import {
  addMacro,
  addMapping,
  canAddMacro,
  canAddMapping,
  macroLabel,
  macroTileNames,
  macroValuePath,
  mappingGroupLabel,
  mappingPickerGroups,
  mappingPlays,
  removeMapping,
  renameMacro,
  setMappingField,
} from './macroModel';
import {
  ADD_MAPPING_HINT,
  CURVE_GLYPH_BOX,
  CURVE_GLYPH_PATHS,
  CURVE_SEGMENT_LABELS,
  MACRO_CARD_PX,
} from './macroTables';
import { commitMacros, removeMacroAndItsLanes } from './macroLaneShift';
import { openConfirm } from './metadataModal';
import type { PatchEditor } from './partsSession';
import { getPath, pathKnob } from './patchPath';
import { knobRangeOf, voiceKnobRange } from './patchKnobRange';

/** The selected macro's index: the session's view state, kept across rebuilds. */
let selectedMacro = 0;

/** What every part of the card shares: the editor, the commit and the rebuild. */
interface MacroCardView {
  readonly editor: PatchEditor;
  /** Write `next` into the working patch and push it. */
  commit(next: Macro[]): void;
  /** Draw the card again: after a structural edit. */
  rebuild(): void;
  /** Re-read the texts a knob move changes: the head's value and each row's `plays`. */
  sync(): void;
}

const macrosOf = (view: MacroCardView): Macro[] => view.editor.patch.macros;

/** The lock a lane puts on macro `index`'s knob, if one holds it. */
const macroLock = (view: MacroCardView, index: number): KnobAutomation | null =>
  view.editor.automation?.(macroValuePath(index)) ?? null;

/** Macro `index`'s value as its knob shows it: a lane's where one holds it, else the patch's. */
const liveValue = (view: MacroCardView, index: number): number =>
  macroLock(view, index)?.value ?? macrosOf(view)[index]?.value ?? 0;

const button = (className: string, text: string, label?: string): HTMLButtonElement => {
  const b = el('button', className, text) as HTMLButtonElement;
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  return b;
};

/** `1 mapping`, `3 mappings`. */
const mappingCount = (n: number): string => `${n} mapping${n === 1 ? '' : 's'}`;

/** The macros card, rebuilt whole into `#macroCard`. */
export function buildMacroCard(editor: PatchEditor): void {
  const root = $('macroCard');
  for (const [prop, px] of Object.entries(MACRO_CARD_PX)) root.style.setProperty(prop, `${px}px`);
  const syncs: (() => void)[] = [];
  const view: MacroCardView = {
    editor,
    commit: (next) => commitMacros(editor, next),
    rebuild: () => buildMacroCard(editor),
    sync: () => syncs.forEach((sync) => sync()),
  };
  selectedMacro = Math.min(selectedMacro, Math.max(0, macrosOf(view).length - 1));
  const maps = el('div', 'macro-maps');
  const showMaps = (): void => {
    syncs.length = 0;
    maps.replaceChildren(...mappingSection(view, selectedMacro, syncs));
  };
  root.replaceChildren(titleRow(view), tileRow(view, showMaps), maps);
  showMaps();
}

function addAndSelect(view: MacroCardView): void {
  const macros = macrosOf(view);
  if (!canAddMacro(macros)) return;
  view.commit(addMacro(macros));
  selectedMacro = macros.length;
  view.rebuild();
}

function titleRow(view: MacroCardView): HTMLElement {
  const head = el('div', 'section-title');
  head.appendChild(el('span', '', 'Macros'));
  const after = el('span', 'after');
  after.appendChild(el('span', 'macro-count', `${macrosOf(view).length} / ${MACROS_MAX}`));
  const add = button('btn small', '+ Macro');
  add.disabled = !canAddMacro(macrosOf(view));
  add.onclick = (): void => addAndSelect(view);
  after.appendChild(add);
  head.appendChild(after);
  return head;
}

function tileRow(view: MacroCardView, showMaps: () => void): HTMLElement {
  const row = el('div', 'macro-tiles');
  const tiles = macrosOf(view).map((macro, i) => {
    const tile = macroTile(view, macro, i);
    tile.onclick = (): void => {
      if (selectedMacro === i) return;
      selectedMacro = i;
      tiles.forEach((t, j) => t.classList.toggle('selected', j === i));
      showMaps();
    };
    return tile;
  });
  row.append(...tiles);
  const add = button('macro-tile add', '+ Macro', 'Add a macro');
  add.disabled = !canAddMacro(macrosOf(view));
  add.onclick = (): void => addAndSelect(view);
  row.appendChild(add);
  return row;
}

/**
 * A name field: committed on change, a name that trims to nothing reverting
 * to the previous one. A rename calls `relabel`, so the tile's knob and
 * remove button announce the new name without a rebuild taking focus away.
 */
function nameField(view: MacroCardView, index: number, relabel: () => void): HTMLInputElement {
  const input = document.createElement('input');
  input.className = 'field';
  input.name = `macro-name-${index}`;
  input.value = macrosOf(view)[index]?.name ?? '';
  input.setAttribute('aria-label', `Name of macro ${index + 1}`);
  input.onchange = (): void => {
    const previous = macrosOf(view)[index]?.name ?? '';
    if (input.value.trim() === '' || input.value.trim() === previous) {
      input.value = previous;
      return;
    }
    view.commit(renameMacro(macrosOf(view), index, input.value));
    relabel();
    view.sync();
  };
  return input;
}

function macroTile(view: MacroCardView, macro: Macro, index: number): HTMLElement {
  const tile = el('div', index === selectedMacro ? 'macro-tile selected' : 'macro-tile');
  const names = macroTileNames(macro, index);
  const remove = button('x', '×', names.remove);
  remove.onclick = (e): void => {
    e.stopPropagation();
    void confirmRemove(view, index, remove);
  };
  const path = macroValuePath(index);
  const row = requireCatalogRow(voiceTargetId(path));
  const knob = pathKnob(view.editor, path, names.knob, {
    ...voiceKnobRange(path as VoiceTargetPath),
    def: makeMacro().value,
    color: CARRIER_COLOR,
    fmt: (v) => readout(row, v),
    onChange: () => view.sync(),
  });
  const relabel = (): void => {
    const now = macrosOf(view)[index];
    if (!now) return;
    const renamed = macroTileNames(now, index);
    remove.setAttribute('aria-label', renamed.remove);
    relabelKnob(knob, renamed.knob);
  };
  tile.append(remove, nameField(view, index, relabel), knob);
  tile.appendChild(el('div', 'count', mappingCount(macro.mappings.length)));
  return tile;
}

async function confirmRemove(view: MacroCardView, index: number, opener: HTMLElement) {
  const macro = macrosOf(view)[index];
  if (!macro) return;
  const n = macro.mappings.length;
  const ok = await openConfirm({
    title: 'Remove macro',
    body: `Remove ${macroLabel(macro, index)}${n === 0 ? '' : ` and its ${mappingCount(n)}`}?`,
    ok: 'Remove',
    opener,
  });
  if (!ok) return;
  // Lanes follow their macro: the parts' lanes on it go and the later ones move down, in this step.
  removeMacroAndItsLanes(view.editor, index);
  if (selectedMacro > index) selectedMacro--;
  view.rebuild();
}

/** The selected macro's mapping list, headed by its name, then `+ Add mapping`. */
function mappingSection(view: MacroCardView, index: number, syncs: (() => void)[]): HTMLElement[] {
  const macro = macrosOf(view)[index];
  if (!macro) return [];
  const head = el('div', 'map-head');
  const who = el('span', 'who');
  const n = el('span', 'n');
  head.append(who, n);
  syncs.push(() => {
    const now = macrosOf(view)[index];
    if (!now) return;
    who.textContent = macroLabel(now, index);
    const count = `${now.mappings.length} of ${MACRO_MAPPINGS_MAX} mappings`;
    n.textContent = `· ${count} · macro at ${liveValue(view, index).toFixed(2)}`;
  });
  const list = el('div', 'map-list');
  macro.mappings.forEach((_, j) => list.appendChild(mappingRow(view, index, j, syncs)));
  view.sync();
  // A lane on the macro moves what the rows play: follow it on the frame loop, as its knob does.
  followAutomation(head, () => macroLock(view, index), view.sync);
  return [head, list, addMappingRow(view, index)];
}

const VOICE_ROWS = new Map<string, VoiceAutomationRow>(
  VOICE_AUTOMATION_ROWS.map((row) => [row.path, row]),
);

function mappingRow(
  view: MacroCardView,
  index: number,
  at: number,
  syncs: (() => void)[],
): HTMLElement {
  const mapping = (): Macro['mappings'][number] | undefined => macrosOf(view)[index]?.mappings[at];
  const target = mapping()?.target ?? '';
  const row = VOICE_ROWS.get(target);
  const box = el('div', 'map-row');
  if (!row) return box;
  const name = el('div', 'target');
  const plays = el('span', 'plays');
  name.append(el('span', 'name', row.label), el('span', 'kind', mappingGroupLabel(row)), plays);
  syncs.push(() => {
    const m = mapping();
    const macro = macrosOf(view)[index];
    const value = m && macro ? mappingPlays(m, liveValue(view, index)) : undefined;
    if (value !== undefined) plays.textContent = `plays ${readout(row, value)}`;
  });
  const end = (field: 'min' | 'max', label: string): HTMLElement =>
    makeKnob({
      label,
      ...knobRangeOf(row),
      def: Number(getPath(view.editor.patch, target) ?? row.min),
      color: CARRIER_COLOR,
      fmt: (v) => readout(row, v),
      get: () => mapping()?.[field] ?? row.min,
      set: (v) => view.commit(setMappingField(macrosOf(view), index, at, field, v)),
      onChange: () => view.sync(),
    });
  const remove = button('btn icon', '×', `Remove the ${row.label} mapping`);
  remove.onclick = (): void => {
    view.commit(removeMapping(macrosOf(view), index, at));
    view.rebuild();
  };
  box.append(name, end('min', 'Min'), end('max', 'Max'), curveControls(view, index, at), remove);
  return box;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(tag: string, attrs: Readonly<Record<string, string | number>>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** A curve's glyph: its two axes and its shape, mirrored when the mapping is inverted. */
function curveGlyph(curve: number, inverted: boolean): SVGElement {
  const { w, h, inset } = CURVE_GLYPH_BOX;
  const svg = svgNode('svg', { class: 'glyph', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
  const name = MACRO_CURVE_NAMES[curve] ?? MACRO_CURVE_NAMES[0];
  svg.append(
    svgNode('line', { x1: inset, y1: h - inset, x2: w - inset, y2: h - inset }),
    svgNode('line', { x1: inset, y1: inset, x2: inset, y2: h - inset }),
    svgNode('path', {
      d: CURVE_GLYPH_PATHS[name],
      ...(inverted ? { transform: `translate(${w} 0) scale(-1 1)` } : {}),
    }),
  );
  return svg;
}

/** The curve glyph and its segment, then Invert: each a field of the mapping. */
function curveControls(view: MacroCardView, index: number, at: number): DocumentFragment {
  const mapping = (): Macro['mappings'][number] | undefined => macrosOf(view)[index]?.mappings[at];
  const curve = el('div', 'curve');
  const glyph = el('span', 'glyph-slot');
  const drawGlyph = (): void => {
    const m = mapping();
    if (m) glyph.replaceChildren(curveGlyph(m.curve, m.inverted));
  };
  const segment = seg(
    MACRO_CURVE_NAMES.map((name, id) => ({ value: String(id), label: CURVE_SEGMENT_LABELS[name] })),
    () => String(mapping()?.curve ?? 0),
    (value) => {
      view.commit(setMappingField(macrosOf(view), index, at, 'curve', Number(value)));
      drawGlyph();
      view.sync();
    },
    MOD_COLOR,
  );
  segment.classList.add('tight');
  curve.append(glyph, segment);
  drawGlyph();
  const inv = button('btn small inv', 'Inv', 'Invert');
  const showInv = (): void =>
    inv.setAttribute('aria-pressed', String(mapping()?.inverted === true));
  inv.onclick = (): void => {
    view.commit(setMappingField(macrosOf(view), index, at, 'inverted', !mapping()?.inverted));
    showInv();
    drawGlyph();
    view.sync();
  };
  showInv();
  const fragment = document.createDocumentFragment();
  fragment.append(curve, inv);
  return fragment;
}

/** `+ Add mapping`, its hint, and the target picker it opens. */
function addMappingRow(view: MacroCardView, index: number): HTMLElement {
  const wrap = el('div', 'map-add');
  const add = button('btn small', '+ Add mapping');
  add.disabled = !canAddMapping(macrosOf(view), index);
  const picker = targetPicker(view, index);
  picker.hidden = true;
  const outside = (e: Event): void => {
    if (!wrap.contains(e.target as Node)) close();
  };
  const escape = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  function close(): void {
    picker.hidden = true;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape, true);
  }
  add.onclick = (): void => {
    if (!picker.hidden) return close();
    picker.hidden = false;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
  };
  wrap.append(add, el('span', 'hint', ADD_MAPPING_HINT), picker);
  return wrap;
}

/** The picker: the voice's groups, a target a mapping covers greyed with its macro's name. */
function targetPicker(view: MacroCardView, index: number): HTMLElement {
  const picker = el('div', 'macro-picker');
  const groups = el('div', 'groups');
  for (const group of mappingPickerGroups(macrosOf(view))) {
    const box = el('div', 'g');
    box.appendChild(el('h4', '', group.label));
    for (const option of group.options) {
      const b = button(option.takenBy ? 'taken' : '', option.label);
      if (option.takenBy) {
        b.disabled = true;
        b.appendChild(el('small', '', option.takenBy));
      }
      b.onclick = (): void => {
        const current = Number(getPath(view.editor.patch, option.path) ?? 0);
        view.commit(addMapping(macrosOf(view), index, option.path, current));
        view.rebuild();
      };
      box.appendChild(b);
    }
    groups.appendChild(box);
  }
  picker.appendChild(groups);
  return picker;
}
