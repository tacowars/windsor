/**
 * A part's CC mappings through the console's structural edits (windsor#782,
 * record `2026-10-13-midi-cc-mapping` decision 10), as its lanes go:
 * deleting an insert drops its mappings in the same edit and deleting a part
 * drops them with it, one undo bringing both back; a preset swap keeps every
 * mapping, one on a macro the new patch lacks and one on a target its macro
 * now maps included (inert at play time, not removed). The normaliser that
 * runs after every merge does the dropping (`ccMappingNormalise.ts`).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import {
  AUTOMATION_DOCUMENT,
  AUTOMATION_TAPE_ID,
} from '@windsor/engine/__fixtures__/automationSong';
import { FULL_SLOT } from '@windsor/engine/__fixtures__/fullArrangement';
import type { ArrangementDocument, CcMapping, DocumentPart } from '@windsor/engine';
import { formatTargetId, makeMacro, makePatch, partAt } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { removeInsert } from './insertEdits';
import { insertChange, insertsOf } from './insertTarget';
import { library, loadPageLibrary } from './libraryModel';
import { removePartLive } from './partEdits';
import { pickPreset } from './presetBrowser';

beforeAll(() => loadPageLibrary(library));

const { hat } = FULL_SLOT;
const TAPE_DRIVE = formatTargetId({ kind: 'insert', insertId: AUTOMATION_TAPE_ID, field: 'drive' });
const ACCENT_LEAD = 'accent-lead';

const mapping = (target: string, cc: number, min: number, max: number): CcMapping =>
  ({ source: { device: 'MPK', channel: 1, cc }, target, min, max, inverted: false }) as CcMapping;

/** The hat's mappings: the strip, its Tape (the first insert), the cutoff and macro 4. */
const MAPPINGS: readonly CcMapping[] = [
  mapping('strip.pan', 10, -1, 1),
  mapping(TAPE_DRIVE, 20, -6, 12),
  mapping('voice.filter.cutoff', 74, 2000, 6000),
  mapping('voice.macros.3.value', 21, 0, 1),
];

/** `AUTOMATION_DOCUMENT` with the hat's mappings and a song patch whose one macro maps the cutoff. */
const DOC: ArrangementDocument = {
  ...AUTOMATION_DOCUMENT,
  parts: AUTOMATION_DOCUMENT.parts.map((part) =>
    part.slot === hat ? { ...part, ccMappings: MAPPINGS } : part,
  ),
  patches: {
    ...AUTOMATION_DOCUMENT.patches,
    [ACCENT_LEAD]: makePatch({
      macros: [makeMacro({ name: 'Accent', mappings: [{ target: 'filter.cutoff' }] })],
    }),
  },
};

/** A console over `DOC` whose host takes every partial, with a transport an undo's rebuild reads. */
function openConsole(): AppContext<TabPanel> {
  const host: ContextHost = {
    apply: () => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
    model: new DocumentModel(DOC),
    notify: () => {},
  });
  ctx.addTab('parts', { hidden: false }, () => {});
  return ctx;
}

const hatPart = (doc: ArrangementDocument): DocumentPart | undefined => partAt(doc, hat);

describe('a part’s CC mappings through the console’s edits', () => {
  it('deleting an insert drops its mappings in the same edit, and one undo brings both back', () => {
    const ctx = openConsole();
    const before = ctx.model.doc;
    expect(ctx.change(insertChange(hat, removeInsert(insertsOf(ctx, hat), 0))).ok).toBe(true);
    expect(hatPart(ctx.model.doc)?.ccMappings).toEqual(MAPPINGS.filter((m) => m !== MAPPINGS[1]));
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
  });

  it('deleting a part drops its mappings with it, and one undo brings them back', () => {
    const ctx = openConsole();
    const before = ctx.model.doc;
    expect(removePartLive(ctx, hat)).toBe(true);
    expect(hatPart(ctx.model.doc)).toBeUndefined();
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc).toEqual(before);
  });

  it('a preset swap keeps every mapping, on a macro the patch lacks or a target its macro maps', () => {
    const ctx = openConsole();
    expect(pickPreset(ctx, hat, ACCENT_LEAD, () => {})).toBe(true);
    expect(hatPart(ctx.model.doc)?.preset).toBe(ACCENT_LEAD);
    expect(hatPart(ctx.model.doc)?.ccMappings).toEqual(MAPPINGS);
  });
});
