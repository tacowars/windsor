/**
 * A step strip's ratchet cell (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decision 6; drawn as the Euclid
 * card's, windsor#356): one 14 px cell per step under S. It reads ×1, or
 * draws a tick per hit of a roll of 2 to 4; a click cycles the roll. A rest
 * or a tie has none: its cell is grey and takes no click. The Grid draws it
 * first, and the Arp and Basslead will share it; the rules are
 * `ratchetModel.ts`.
 */
import { el } from './dom';

/** What one cell shows and does. */
export interface RatchetCellSpec {
  /** The step's index, for its label. */
  readonly step: number;
  /** The step's roll, 1 to `RATCHET_MAX`. */
  readonly roll: number;
  /** False on a rest or a tie: grey, inert. */
  readonly takes: boolean;
  /** Cycle the roll one on. */
  readonly cycle: () => void;
}

/** The cell for one step. */
export function ratchetCell(spec: RatchetCellSpec): HTMLButtonElement {
  const { step, roll, takes } = spec;
  const cell = el('button', `gcell ratchet r${takes ? roll : 1}`) as HTMLButtonElement;
  cell.type = 'button';
  if (!takes) {
    cell.classList.add('idle');
    cell.disabled = true;
    cell.title = 'A rest or a tie has no ratchet';
    cell.setAttribute('aria-label', `Step ${step + 1} ratchet: none on a rest or a tie`);
    return cell;
  }
  if (roll > 1) {
    const ticks = el('span', 'ratchet-ticks');
    for (let t = 0; t < roll; t++) ticks.appendChild(el('i'));
    cell.appendChild(ticks);
  } else {
    cell.textContent = '×1';
  }
  cell.title = `Ratchet ×${roll}: click for ×1 → ×2 → ×3 → ×4`;
  cell.setAttribute('aria-label', `Step ${step + 1} ratchet: times ${roll}`);
  cell.onclick = spec.cycle;
  return cell;
}
