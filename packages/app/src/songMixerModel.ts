/**
 * The mixer column's writes (windsor#157, windsor#158; record
 * `2026-09-30-mixer-on-the-song-tab`): a part's Level and its M and S, and
 * expanded its Pan, Low cut, sends and Output, each through the same
 * `ctx.change(partChange(slot, { strip }))` the Mixer tab uses, then
 * `ctx.invalidate()` so the Mixer tab redraws when opened. The cell that
 * calls them is `songMixerCell.ts`; the rules live here so a test drives
 * them without a DOM.
 */
import type { ChannelStrip } from '@windsor/engine';
import { DEFAULT_STRIP, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { partChange } from './context';
import { withGesture } from './gestureHooks';

/**
 * Where a strip plays: the master, or only its sidechain key. A group
 * Output (windsor#284) isn't offered here yet: windsor#287 adds it.
 */
export type StripOutput = 'master' | 'sidechain';

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
 * The strip's Output; a missing field plays to the master. A group Output
 * reads as Master until windsor#287 lists the groups.
 */
export const stripOutput = (strip: ChannelStrip): StripOutput =>
  strip.output === 'sidechain' ? 'sidechain' : 'master';

/**
 * What the mixer column shows of every part, collapsed or expanded: its
 * Level, Pan, Low cut, sends, Output, M and S. The lanes' signature leaves
 * the strips out, so the view watches this one to redraw the column in
 * place after a Mixer tab edit.
 */
export function stripSignature(ctx: AppCtx): string {
  return JSON.stringify(
    ctx.model.doc.parts.map(({ slot, strip }) => [
      slot,
      strip.level,
      strip.pan,
      strip.lowCut,
      strip.sends,
      stripOutput(strip),
      switchOn(strip, 'mute'),
      switchOn(strip, 'solo'),
    ]),
  );
}

/** Write a strip field live and into the document; the Mixer tab redraws when opened. */
function writeStrip(ctx: AppCtx, slot: number, strip: Partial<ChannelStrip>): boolean {
  const { ok } = ctx.change(partChange(slot, { strip }));
  if (ok) ctx.invalidate();
  return ok;
}

/** Set the part's Level. */
export function setStripLevel(ctx: AppCtx, slot: number, level: number): void {
  writeStrip(ctx, slot, { level });
}

/** Set the part's Pan (windsor#158). */
export function setStripPan(ctx: AppCtx, slot: number, pan: number): void {
  writeStrip(ctx, slot, { pan });
}

/** Set the part's Low cut, in Hz (windsor#158). */
export function setStripLowCut(ctx: AppCtx, slot: number, lowCut: number): void {
  writeStrip(ctx, slot, { lowCut });
}

/** Set the part's send to one return (windsor#158); the other sends stay. */
export function setStripSend(ctx: AppCtx, slot: number, ret: string, level: number): void {
  writeStrip(ctx, slot, { sends: { [ret]: level } });
}

/**
 * Route the part to the master or only to its sidechain key (windsor#158).
 * False when the engine refused it; nothing changed then. The cell re-syncs
 * its M and S after it, since `switchEnabled` follows the Output.
 */
export function setStripOutput(ctx: AppCtx, slot: number, output: StripOutput): boolean {
  return writeStrip(ctx, slot, { output });
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
