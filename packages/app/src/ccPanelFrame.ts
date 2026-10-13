/**
 * The MIDI CC panel's frame (windsor#784, the mockup's `.cc-head`, `.cc-off`
 * and `.cc-foot`): the header with This part | All parts, Pickup | Jump,
 * Reset performance and ×; the banner while MIDI is off; and the foot with
 * "+ Add mapping", the part's voice count and the hint. Drawn from values;
 * the panel owns what each control does.
 */
import { el, seg } from './dom';
import type { CcFilter } from './ccPanelModel';
import type { CcTakeover } from './ccTakeover';
import type { MidiState } from './midiAccess';

/** What the header's controls do and show. */
export interface CcHeadControls {
  filter(): CcFilter;
  setFilter(filter: CcFilter): void;
  takeover(): CcTakeover;
  setTakeover(takeover: CcTakeover): void;
  reset(): void;
  close(): void;
}

const button = (text: string, className = 'btn'): HTMLButtonElement => {
  const b = el('button', className, text) as HTMLButtonElement;
  b.type = 'button';
  return b;
};

const CARRIER = 'var(--carrier)';

/** The header row. */
export function ccHead(controls: CcHeadControls): HTMLElement {
  const head = el('div', 'cc-head');
  const filter = seg(
    [
      { value: 'this', label: 'This part' },
      { value: 'all', label: 'All parts' },
    ],
    controls.filter,
    (value) => controls.setFilter(value as CcFilter),
    CARRIER,
  );
  filter.classList.add('cc-filter');
  const take = seg(
    [
      { value: 'pickup', label: 'Pickup' },
      { value: 'jump', label: 'Jump' },
    ],
    controls.takeover,
    (value) => controls.setTakeover(value as CcTakeover),
    CARRIER,
  );
  take.classList.add('cc-take');
  take.title =
    'Pickup: a knob takes over once it reaches the value. Jump: every value applies at once';
  const reset = button('Reset performance');
  reset.title = 'Drop every CC value: each target goes back to its patch value, and pickup re-arms';
  reset.onclick = controls.reset;
  const close = button('×', 'btn icon');
  close.setAttribute('aria-label', 'Close');
  close.onclick = controls.close;
  head.append(
    el('span', 'cc-title', 'MIDI CC'),
    filter,
    el('span', 'grow'),
    el('span', 'field-label', 'Takeover'),
    take,
    reset,
    close,
  );
  return head;
}

/** The banner's words for a MIDI state other than ready, and whether it offers Enable MIDI. */
export function midiOffText(state: MidiState, error: string): { text: string; enable: boolean } {
  switch (state) {
    case 'unsupported':
      return {
        text: 'MIDI is not supported in this browser (use Chrome or Edge). Your mappings are kept.',
        enable: false,
      };
    case 'requesting':
      return { text: 'MIDI: waiting for permission…', enable: false };
    case 'denied':
      return {
        text: `MIDI access was refused${error ? ` (${error})` : ''}. Your mappings are kept.`,
        enable: true,
      };
    default:
      return {
        text: 'MIDI is off. Your mappings are kept; enable MIDI to play and learn them.',
        enable: true,
      };
  }
}

/** The banner while MIDI is not ready, with the keyboard bar's Enable MIDI where it applies. */
export function ccOffBanner(state: MidiState, error: string, enable: () => void): HTMLElement {
  const banner = el('div', 'cc-off');
  const words = midiOffText(state, error);
  banner.append(el('span', '', words.text));
  if (words.enable) {
    const on = button('Enable MIDI');
    on.onclick = enable;
    banner.append(on);
  }
  return banner;
}

/** What the foot shows. */
export interface CcFootView {
  readonly canAdd: boolean;
  readonly picking: boolean;
  /** "Voice 5/8 · Acid", or empty with no part. */
  readonly count: string;
  readonly full: boolean;
  readonly hint: string;
}

/** The foot: "+ Add mapping", the count and the hint; `list` hangs under it while picking. */
export function ccFoot(view: CcFootView, add: () => void, list: HTMLElement | null): HTMLElement {
  const foot = el('div', 'cc-foot');
  const plus = button('+ Add mapping');
  plus.disabled = !view.canAdd;
  plus.setAttribute('aria-expanded', String(view.picking));
  plus.onclick = add;
  const count = el('span', 'auto-count', view.count);
  count.classList.toggle('full', view.full);
  foot.append(plus, count, el('span', 'hint', view.hint));
  if (list) foot.append(list);
  return foot;
}
