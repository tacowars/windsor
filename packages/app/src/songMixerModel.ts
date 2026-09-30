/**
 * The mixer column's writes (windsor#157; record
 * `2026-09-30-mixer-on-the-song-tab`): a part's Level and its M and S, each
 * through the same `ctx.change(partChange(slot, { strip }))` the Mixer tab
 * uses, then `ctx.invalidate()` so the Mixer tab redraws when opened. The
 * cell that calls them is `songMixerCell.ts`; the rules live here so a test
 * drives them without a DOM.
 */
import type { ChannelStrip } from '@windsor/engine';
import { DEFAULT_STRIP, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { withGesture } from './gestureHooks';

/** The strip's two switches (windsor#154). */
export type StripSwitch = 'mute' | 'solo';

const SWITCH_VERB: Readonly<Record<StripSwitch, string>> = { mute: 'Mute', solo: 'Solo' };

/** The part's strip as the document holds it; the default for a slot with no part. */
export function stripOf(ctx: AppCtx, slot: number): ChannelStrip {
  return partAt(ctx.model.doc, slot)?.strip ?? DEFAULT_STRIP;
}

/** A switch's label, its button's `aria-label` and its undo step: "Mute Pulse". */
export const switchLabel = (which: StripSwitch, partName: string): string =>
  `${SWITCH_VERB[which]} ${partName}`;

/**
 * Whether M and S apply: a sidechain-only part plays nothing to mute or
 * solo (its key is tapped before both), so its buttons are disabled.
 */
export const switchesApply = (strip: ChannelStrip): boolean => strip.output !== 'sidechain';

/** Whether the switch is on; a missing field is off. */
export const switchOn = (strip: ChannelStrip, which: StripSwitch): boolean => strip[which] === true;

/**
 * Whether the switch can be pressed. On a sidechain-only part only a lit
 * switch can, and only to turn it off: a solo set before the part's output
 * moved to the sidechain still silences every other part, so it must stay
 * clearable here (windsor#157, amended on PR #168).
 */
export const switchEnabled = (strip: ChannelStrip, which: StripSwitch): boolean =>
  switchesApply(strip) || switchOn(strip, which);

/**
 * What the mixer column shows of every part: its Level, M, S and whether
 * they apply. The lanes' signature leaves the strips out, so the view
 * watches this one to redraw the column in place after a Mixer tab edit.
 */
export function stripSignature(ctx: AppCtx): string {
  return JSON.stringify(
    ctx.model.doc.parts.map(({ slot, strip }) => [
      slot,
      strip.level,
      switchOn(strip, 'mute'),
      switchOn(strip, 'solo'),
      switchesApply(strip),
    ]),
  );
}

/** Set the part's Level live and into the document; the Mixer tab redraws when opened. */
export function setStripLevel(ctx: AppCtx, slot: number, level: number): void {
  if (ctx.change(partChange(slot, { strip: { level } })).ok) ctx.invalidate();
}

/**
 * Flip the part's mute or solo as one undo step named after it. False when
 * the switch is disabled (off on a sidechain-only part), there is no such
 * part, or the engine refused it; nothing changed then.
 */
export function toggleStripSwitch(ctx: AppCtx, slot: number, which: StripSwitch): boolean {
  const part = partAt(ctx.model.doc, slot);
  if (!part || !switchEnabled(part.strip, which)) return false;
  const next = !switchOn(part.strip, which);
  const { ok } = withGesture(switchLabel(which, part.name), () =>
    ctx.change(partChange(slot, { strip: { [which]: next } })),
  );
  if (ok) ctx.invalidate();
  return ok;
}
