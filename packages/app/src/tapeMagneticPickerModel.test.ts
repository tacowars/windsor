/**
 * The hidden magnetic picker's rules (windsor#276 decisions 2 and 3): the
 * flag, the options, the per-stage session, and that a choice never reaches
 * the song document, driven over the context with a fake host as
 * `eqRoundTrip.test.ts` does.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { TAPE_MAGNETIC_CANDIDATES, setTapeMagneticOverride } from '@windsor/engine';
import type { TapeMagneticRow } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { addInsert } from './insertEdits';
import { insertChange, insertsOf } from './insertTarget';
import { library, loadPageLibrary } from './libraryModel';
import { newSong } from './songParts';
import {
  createMagneticOverrides,
  magneticLabel,
  magneticOptions,
  magneticRowOf,
  tapeDevEnabled,
} from './tapeMagneticPickerModel';

beforeAll(() => loadPageLibrary(library));

/** A live Tape stage whose port records what it was sent. */
function fakeStage(): { stage: { kind: 'tape'; processor: AudioWorkletNode }; posted: unknown[] } {
  const posted: unknown[] = [];
  const processor = { port: { postMessage: (m: unknown) => posted.push(m) } };
  return { stage: { kind: 'tape', processor: processor as unknown as AudioWorkletNode }, posted };
}

describe('the flag', () => {
  it('shows the picker for ?tapeDev with any value or none, and only then', () => {
    for (const search of ['?tapeDev', '?tapeDev=1', '?tapeDev=', '?a=1&tapeDev'])
      expect(tapeDevEnabled(search)).toBe(true);
    for (const search of ['', '?', '?tapedev', '?tapeDevX=1', '?a=tapeDev'])
      expect(tapeDevEnabled(search)).toBe(false);
  });
});

describe('the options', () => {
  it('starts with "Model row", then every allowed point to two decimals', () => {
    const options = magneticOptions();
    expect(options[0]).toEqual(['', 'Model row']);
    expect(options).toHaveLength(TAPE_MAGNETIC_CANDIDATES.length + 1);
    expect(options[1]).toEqual(['0', '0.50 / 0.50 / 0.50']);
    expect(new Set(options.map(([, text]) => text)).size).toBe(options.length);
    for (const [value, text] of options.slice(1)) {
      expect(text).toMatch(/^\d\.\d\d \/ \d\.\d\d \/ \d\.\d\d( \(.*\))?$/);
      expect(magneticRowOf(value)).toBe(TAPE_MAGNETIC_CANDIDATES[Number(value)]);
    }
  });

  it('marks the 1 / 0 / 1 corner, and only it, as least accurate', () => {
    const marked = magneticOptions().filter(([, text]) => text.includes('least accurate'));
    expect(marked.map(([, text]) => text)).toEqual([
      '1.00 / 0.00 / 1.00 (least accurate on bright material)',
    ]);
    expect(magneticLabel([1, 0, 0])).toBe('1.00 / 0.00 / 0.00');
  });

  it('reads an option back: the model row, a point, or nothing', () => {
    expect(magneticRowOf('')).toBeNull();
    expect(magneticRowOf('3')).toEqual(TAPE_MAGNETIC_CANDIDATES[3]);
    for (const value of ['99', '-1', '1.5', 'x', ' 1'])
      expect(magneticRowOf(value)).toBeUndefined();
  });
});

describe('the session', () => {
  it('keeps a choice per live stage, and the model row back clears it', () => {
    const overrides = createMagneticOverrides();
    const a = fakeStage(),
      b = fakeStage();
    const send = (stage: object) => (row: TapeMagneticRow | null) =>
      setTapeMagneticOverride(stage as typeof a.stage, row);
    expect(overrides.choose(a.stage, '5', send(a.stage))).toBe(true);
    expect(overrides.value(a.stage)).toBe('5');
    expect(overrides.value(b.stage)).toBe('');
    expect(b.posted).toEqual([]);
    expect(overrides.choose(a.stage, '', send(a.stage))).toBe(true);
    expect(overrides.value(a.stage)).toBe('');
    expect(a.posted).toEqual([
      { type: 'magneticOverride', row: [...TAPE_MAGNETIC_CANDIDATES[5]!] },
      { type: 'magneticOverride', row: null },
    ]);
  });

  it('remembers nothing without a stage, for no option, or when the engine refuses', () => {
    const overrides = createMagneticOverrides();
    const a = fakeStage();
    expect(overrides.choose(undefined, '2', () => true)).toBe(false);
    expect(overrides.value(undefined)).toBe('');
    expect(overrides.choose(a.stage, '99', () => true)).toBe(false);
    expect(overrides.choose(a.stage, '2', () => false)).toBe(false);
    expect(overrides.value(a.stage)).toBe('');
  });
});

describe('the song document', () => {
  function openConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
    const model = new DocumentModel(newSong());
    const host: ContextHost = {
      apply: () => ({ ok: true, ignored: [] }),
      build: () => Promise.resolve(),
      isBuilding: false,
      capturePattern: () => null,
      part: () => null,
    };
    const ctx = new AppContext<TabPanel>({
      host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
      model,
      notify: () => {},
    });
    ctx.addTab('mixer', { hidden: false }, () => {});
    return { ctx, model };
  }

  it('is the same with an override set as without: export, import and undo see none', () => {
    const { ctx, model } = openConsole();
    expect(ctx.change(insertChange(0, addInsert([], 'tape', 0))).ok).toBe(true);
    expect(insertsOf(ctx, 0)[0]?.kind).toBe('tape');
    const without = model.toJson();
    const overrides = createMagneticOverrides();
    const live = fakeStage();
    for (const value of ['0', '4', '12'])
      expect(
        overrides.choose(live.stage, value, (row) => setTapeMagneticOverride(live.stage, row)),
      ).toBe(true);
    expect(live.posted).toHaveLength(3);
    expect(model.toJson()).toBe(without);
    expect(new DocumentModel(JSON.parse(model.toJson())).toJson()).toBe(without);
    expect(model.toJson()).not.toMatch(/magnetic|override/i);
  });
});
