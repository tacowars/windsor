/**
 * The pattern actions a sequencer card offers (windsor#827; record
 * `2026-10-16-song-tab-context-menu`, decision 2), pure: what each card's
 * Randomize, Reverse, Reseed, Capture or Release and Quantize writes, as a
 * partial from the document and what the card reads besides (the chord, the
 * Euclid figure, the Roll's Snap, a random draw), and the rule that turns a
 * button off, with its reason. The card's button and the Song tab's region
 * menu both run an action through `patternActionRun.ts`, so they write the
 * same document as one undo step with the same name.
 *
 * Which actions a kind offers is the keys of its entry in `PATTERN_ACTIONS`,
 * in the order the cards and the menu list them: Chord has none at all. The
 * Grid's Reseed came with step variation (windsor#936), whose draws its seed
 * shapes. The Roll's Quantize here acts on every note, as the card's
 * does with nothing selected; the card's own press also reads its selection
 * (`rollEditing.ts`), over the same `quantiseNotes`.
 */
import type {
  ArrangementDocument,
  DocumentPartial,
  HarmonyChord,
  SequencerKind,
  SequencerSpec,
} from '@windsor/engine';
import { scaleOffsets } from '@windsor/engine';
import { arpCellCount, randomArpCells, reverseArp } from './arpGridModel';
import { arpSeedChange, freshSeed } from './arpModel';
import { randomBassSteps, reverseBass } from './bassGridModel';
import { reseedChange } from './bassModel';
import type { Figure } from './euclidModel';
import { FIGURE_SUMMARY_STACK } from './figureConstants';
import { randomFigureCells, reverseFigure } from './figureModel';
import { randomSteps, reverseGrid } from './gridModel';
import { patternOf, regionPatternChange } from './partEdits';
import type { RollFrame } from './rollEdits';
import { quantiseNotes, quantiseOff } from './rollQuantise';
import { ROLL_QUANTISE } from './rollTables';

export type PatternAction = 'randomize' | 'reverse' | 'reseed' | 'capture' | 'quantize';

/** The reason a Figure canon's Randomize and Reverse are off: they would edit cells it doesn't play. */
export const BORROWED_REASON = 'follows its source';

/** What an action reads besides the document, read when it runs, as the card reads it. */
export interface ActionReads {
  random(): number;
  /** The chord the card reads for the region (`regionChord`): Arp and Figure. */
  chord(): HarmonyChord | null;
  /** The figure the Euclid card shows for the region (`regionFigure`): what Capture freezes. */
  figure(): Figure;
  /** The Roll card's frame: the loop as drawn, the region and the card's Snap. */
  rollFrame(): RollFrame;
}

/** Where an action acts: region `region` of the part on `slot` (none: the part's sequencer). */
export interface ActionAt {
  readonly doc: ArrangementDocument;
  readonly slot: number;
  readonly region: number | undefined;
  readonly reads: ActionReads;
}

/** An action's write: the partial, the undo step's name when it isn't the partial's own, and a toast. */
export interface PatternEdit {
  readonly partial: DocumentPartial;
  readonly label?: string;
  readonly notice?: string;
}

type SpecOf<K extends SequencerKind> = Extract<SequencerSpec, { kind: K }>;

/** One action of a kind: its write, and the reason its button is off (null when on). */
interface ActionEntry<S> {
  edit(spec: S, at: ActionAt): PatternEdit | null;
  /** `snapTicks` reads the Roll card's Snap grain, only where a rule needs it. */
  blocked?(spec: S, snapTicks: () => number): string | null;
}

type KindActions = {
  readonly [K in SequencerKind]: Readonly<Partial<Record<PatternAction, ActionEntry<SpecOf<K>>>>>;
};

/** A Figure canon plays its leader's line, so the card holds its own cells (`holdOwnControls`). */
export const cellsBorrowed = (spec: { source?: unknown } | null | undefined): boolean =>
  spec?.source !== undefined;

/** A Euclid region holding a captured figure: its button reads Release. */
export const captured = (spec: SequencerSpec): boolean =>
  spec.kind === 'euclidean' && spec.pattern != null;

/** What the Euclid card says once a capture or a release took. */
export const captureNotice = (slot: number, pattern: Figure | null): string =>
  pattern
    ? `part ${slot}: captured — the figure is a literal array in the document`
    : `part ${slot}: released back to the modulator`;

/** Pattern fields merged into the region's pattern, as `changePattern` writes them. */
function fields(at: ActionAt, values: Readonly<Record<string, unknown>>): PatternEdit | null {
  const partial = regionPatternChange(at.doc, at.slot, at.region, values);
  return partial ? { partial } : null;
}

/** The part's seed, which Grid, Arp and Figure write with `arpSeedChange`. */
const seedEdit = (spec: { seed: number }, at: ActionAt): PatternEdit => ({
  partial: arpSeedChange(
    at.slot,
    freshSeed(spec.seed, () => at.reads.random()),
  ),
});

/** The Arp's shown cells: one cycle of its style over the chord the card reads. */
const arpCount = (spec: SpecOf<'arp'>, at: ActionAt): number =>
  arpCellCount(spec, at.doc.harmony, at.reads.chord());

const borrowed = (spec: SpecOf<'figure'>): string | null =>
  cellsBorrowed(spec) ? BORROWED_REASON : null;

/** Each kind's actions, in the cards' order. */
export const PATTERN_ACTIONS: KindActions = {
  none: {},
  chord: {},
  grid: {
    randomize: {
      edit: (spec, at) =>
        fields(at, {
          steps: randomSteps(spec.steps.length, scaleOffsets(at.doc.harmony.scale).length, () =>
            at.reads.random(),
          ),
        }),
    },
    reverse: { edit: (spec, at) => fields(at, reverseGrid(spec)) },
    reseed: { edit: seedEdit },
  },
  arp: {
    randomize: {
      edit: (spec, at) =>
        fields(at, {
          steps: randomArpCells(spec.steps, arpCount(spec, at), () => at.reads.random()),
        }),
    },
    reverse: { edit: (spec, at) => fields(at, reverseArp(spec, arpCount(spec, at))) },
    reseed: { edit: seedEdit },
  },
  bass: {
    randomize: {
      edit: (spec, at) =>
        fields(at, { steps: randomBassSteps(spec.steps, () => at.reads.random()) }),
    },
    reverse: { edit: (spec, at) => fields(at, reverseBass(spec)) },
    reseed: {
      edit: (_spec, at) =>
        fields(
          at,
          reseedChange(() => at.reads.random()),
        ),
    },
  },
  figure: {
    randomize: {
      edit: (spec, at) => {
        const size = at.reads.chord()?.stack.length ?? FIGURE_SUMMARY_STACK.length;
        const draw = (): number => at.reads.random();
        return fields(at, { cells: randomFigureCells(spec.cells, spec.length, size, draw) });
      },
      blocked: borrowed,
    },
    reverse: { edit: (spec, at) => fields(at, reverseFigure(spec)), blocked: borrowed },
    reseed: { edit: seedEdit },
  },
  euclidean: {
    capture: {
      edit: (spec, at) => {
        const pattern = captured(spec) ? null : at.reads.figure();
        const edit = fields(at, { pattern });
        return edit && { ...edit, notice: captureNotice(at.slot, pattern) };
      },
    },
  },
  roll: {
    quantize: {
      edit: (spec, at) => {
        const edit = quantiseNotes(spec, [], at.reads.rollFrame());
        if (!edit) return null;
        const { loopTicks, notes } = edit.config;
        const write = fields(at, { loopTicks, notes });
        return write && { ...write, label: ROLL_QUANTISE.undo };
      },
      blocked: (_spec, snapTicks) => (quantiseOff(snapTicks()) ? ROLL_QUANTISE.off : null),
    },
  },
};

type AnyEntry = ActionEntry<SequencerSpec>;

/** The entry of `action` for `spec`'s kind, typed for any spec; undefined when the kind doesn't offer it. */
const entryOf = (spec: SequencerSpec, action: PatternAction): AnyEntry | undefined =>
  // The table is keyed by the spec's own kind, which TypeScript cannot correlate through an index.
  (PATTERN_ACTIONS[spec.kind] as Partial<Record<PatternAction, AnyEntry>>)[action];

/** The actions `kind`'s card offers, in its order. */
export const offeredActions = (kind: SequencerKind): PatternAction[] =>
  Object.keys(PATTERN_ACTIONS[kind]) as PatternAction[];

/** Why `action` is off on `spec` (the card's reason), or null when it is on; `snapTicks` is the Roll card's Snap. */
export function actionBlocked(
  action: PatternAction,
  spec: SequencerSpec,
  snapTicks: number,
): string | null {
  return entryOf(spec, action)?.blocked?.(spec, () => snapTicks) ?? null;
}

/**
 * What `action` writes on the region `at` names: null when the kind doesn't
 * offer it, the card has it off, or nothing would change (a Quantize with
 * every note on the grid).
 */
export function patternEdit(action: PatternAction, at: ActionAt): PatternEdit | null {
  const spec = patternOf(at.doc, at.slot, at.region);
  const entry = spec && entryOf(spec, action);
  if (!spec || !entry) return null;
  if (entry.blocked?.(spec, () => at.reads.rollFrame().snap) != null) return null;
  return entry.edit(spec, at);
}
