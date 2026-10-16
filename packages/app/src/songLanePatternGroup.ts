/**
 * The region menu's pattern group (windsor#827; record
 * `2026-10-16-song-tab-context-menu`, decision 2; the approved mockups
 * `docs/design/song-region-menu-mockup.html` and
 * `docs/design/song-region-menu-tablet-mockup.html`), pure: the pattern
 * actions the part's card offers, in its order (`offeredActions`), then Fit
 * region to pattern where the region's pattern has a cycle (`regionFit`).
 * `songLaneMenuModel.ts` sets the group between Loop region and Bounce part
 * to Roll…, a separator on each side.
 *
 * - Grid: Randomize, Reverse. Arp, Basslead and Figure add Reseed. Euclid:
 *   Capture, or Release once captured. Roll: `Quantize to <Snap>` with the
 *   card's Snap, tagged `all notes`. Chord: none, so its group is Fit alone.
 * - A row is off exactly where the card's button is (`actionBlocked`), with
 *   the card's reason as its tag: a Figure canon's Randomize and Reverse,
 *   the Roll's Quantize at Snap Off.
 * - Fit is off with `already fits` when the region is one pass long or has
 *   no room to grow; otherwise its tag is the new length and it previews the
 *   new extent as Paste and Add do.
 */
import type { Meter, MusicPart, SequencerSpec } from '@windsor/engine';
import { regionPattern } from '@windsor/engine';
import type { MenuItem, MenuRow } from './contextMenuModel';
import type { PatternAction } from './patternActionModel';
import { actionBlocked, captured, offeredActions } from './patternActionModel';
import { regionFit } from './regionFit';
import type { Placement } from './regionPlacement';
import { quantiseOff } from './rollQuantise';
import type { RollSnap } from './rollTables';
import { ROLL_QUANTISE } from './rollTables';

/** The group's words, in US English, as the cards name their buttons. */
export const PATTERN_MENU_TEXT = {
  randomize: 'Randomize',
  reverse: 'Reverse',
  reseed: 'Reseed',
  capture: 'Capture',
  release: 'Release',
  quantize: ROLL_QUANTISE.label,
  quantizeTo: (snap: string): string => `${ROLL_QUANTISE.label} ${ROLL_QUANTISE.to} ${snap}`,
  allNotes: 'all notes',
  fit: 'Fit region to pattern',
} as const;

/** What the group reads of the press: the part, the song, and the Roll card's Snap for the part. */
export interface PatternGroupPress {
  readonly part: Pick<MusicPart, 'regions' | 'sequencer'>;
  readonly meter: Meter | undefined;
  /** One bar of `meter`, in ticks. */
  readonly bar: number;
  readonly songTicks: number;
  readonly snap: RollSnap;
}

/** What the group's rows run and preview. */
export interface PatternGroupCommands {
  /** Run `action` on region `index`'s pattern, as the card's button runs it. */
  pattern(index: number, action: PatternAction): void;
  /** Commit regions a fit made, and select the one at `placed.index`. */
  place(placed: Placement): void;
  showRegion(span: { start: number; duration: number }): void;
  unpreview(): void;
}

const off = (label: string, tag?: string): MenuRow => ({
  kind: 'row',
  label,
  run: () => undefined,
  disabled: true,
  ...(tag === undefined ? {} : { tag }),
});

/** The label and tag the card's button would show for `action` on `spec`. */
function actionText(
  action: PatternAction,
  spec: SequencerSpec,
  snap: RollSnap,
): { label: string; tag?: string } {
  if (action === 'capture') {
    return { label: captured(spec) ? PATTERN_MENU_TEXT.release : PATTERN_MENU_TEXT.capture };
  }
  if (action !== 'quantize') return { label: PATTERN_MENU_TEXT[action] };
  if (quantiseOff(snap.ticks)) return { label: PATTERN_MENU_TEXT.quantize };
  return { label: PATTERN_MENU_TEXT.quantizeTo(snap.label), tag: PATTERN_MENU_TEXT.allNotes };
}

function actionRow(
  action: PatternAction,
  spec: SequencerSpec,
  snap: RollSnap,
  run: () => void,
): MenuRow {
  const { label, tag } = actionText(action, spec, snap);
  const reason = actionBlocked(action, spec, snap.ticks);
  if (reason !== null) return off(label, reason);
  return { kind: 'row', label, run, ...(tag === undefined ? {} : { tag }) };
}

/** Fit region to pattern, or null where the pattern has no cycle. */
function fitRow(
  press: PatternGroupPress,
  index: number,
  commands: PatternGroupCommands,
): MenuRow | null {
  const fit = regionFit(press.part, index, press);
  if (!fit) return null;
  if (fit.fits) return off(PATTERN_MENU_TEXT.fit, fit.tag);
  const span = { start: fit.start, duration: fit.duration };
  return {
    kind: 'row',
    label: PATTERN_MENU_TEXT.fit,
    tag: fit.tag,
    run: () => commands.place({ regions: fit.regions, index }),
    preview: () => commands.showRegion(span),
    unpreview: () => commands.unpreview(),
  };
}

/** Region `index`'s pattern group: the card's actions, then Fit; empty where there is neither. */
export function patternGroup(
  press: PatternGroupPress,
  index: number,
  commands: PatternGroupCommands,
): MenuItem[] {
  const spec = regionPattern(press.part, index);
  const actions = offeredActions(spec.kind).map((action) =>
    actionRow(action, spec, press.snap, () => commands.pattern(index, action)),
  );
  const fit = fitRow(press, index, commands);
  return fit ? [...actions, fit] : actions;
}
