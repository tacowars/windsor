/**
 * A device's Seed field with Reseed as an icon beside it: the Arp's
 * (windsor#370 decision 8), and the Grid's since step variation made its
 * seed shape what plays (windsor#936). The field shows and edits the part's
 * seed, and Reseed runs the pattern action the Song tab's region menu runs
 * too (`patternActionRun.ts`): a new seed, which restarts the part's random
 * stream at once.
 */
import { arpSeedChange, parseSeed } from './arpModel';
import type { AppCtx } from './context';
import { el } from './dom';
import { runPatternAction } from './patternActionRun';
import { railIcon, railSvg } from './sequencerRail';

/** Reseed's icon: a circling arrow (the Arp's, Basslead's and the Figure's too). */
export const ICON_RESEED = '<path d="M10 6a4 4 0 1 1-1.2-2.85M10 1.5v2.5H7.5"/>';

/** Whose seed the field edits, and the device it sits on, which names its classes. */
export interface SeedTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  readonly device: 'arp' | 'grid';
  /** The part's seed now. */
  seed(): number;
}

/** The Seed label, the field, and Reseed beside it. */
export function seedField(target: SeedTarget): HTMLElement {
  const { ctx, slot, device } = target;
  const field = document.createElement('input');
  field.className = 'field';
  field.name = `${device}-seed`;
  field.inputMode = 'numeric';
  field.setAttribute('aria-label', 'Seed');
  field.value = String(target.seed());
  field.onchange = (): void => {
    const seed = parseSeed(field.value);
    if (seed === null || !ctx.change(arpSeedChange(slot, seed)).ok) {
      field.value = String(target.seed());
    }
  };
  const reseed = railIcon(
    'A new seed: the part restarts its random stream now',
    `seq-icon ${device}-reseed`,
  );
  reseed.setAttribute('aria-label', 'Reseed');
  reseed.appendChild(railSvg(ICON_RESEED, 'seq-icon-svg seq-line-icon'));
  reseed.onclick = (): void => {
    if (runPatternAction(ctx, slot, target.region, 'reseed')) field.value = String(target.seed());
  };
  const row = el('div', `${device}-seed`);
  row.append(field, reseed);
  const wrap = el('div');
  wrap.append(el('span', 'field-label', 'Seed'), row);
  return wrap;
}
