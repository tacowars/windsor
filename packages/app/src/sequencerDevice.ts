/**
 * The sequencer device (windsor#368, record
 * `2026-10-01-sequencer-rack-devices` decisions 1 and 2; the look is
 * `docs/research/2026-09-30-sequencer-rack/grid.html`): the frame the Song
 * pane wraps a part's sequencer card in. A row as the insert rack draws one
 * (`.seq-rack`), holding one device: the shared rail (`sequencerRail.ts`)
 * and the card's body.
 *
 * A converted card hands back a `DeviceBody` with `fit: 'fixed'`: the device
 * is `--seq-h` high and as wide as its content, never scrolls its steps
 * sideways, and the row scrolls when it is wider than the pane. A card not
 * yet converted (Chord, Arp, Basslead) hands back its element as it was,
 * and sits in the frame at its natural height and the pane's width, its own
 * strip scrolling as before; so does the Euclid card, which adds its own
 * rail buttons (windsor#393 fits it to the height).
 *
 * A click on the rail's name folds the device to the rail, and a click on a
 * folded device opens it. The fold is the session's (`DEVICE_FOLDS`), kept
 * per part.
 */
import type { SequencerKind } from '@windsor/engine';
import { el } from './dom';
import { KIND_LABELS } from './sequencerConstants';
import { DEVICE_FOLDS } from './sequencerDeviceModel';
import { DEVICE_ACCENT, SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';
import { type RailRegion, sequencerRail } from './sequencerRail';
import { LANE_TONE } from './songViewTables';

/** What a card that draws itself as a device hands the frame. */
export interface DeviceBody {
  /** The body beside the rail. */
  readonly body: HTMLElement;
  /** `fixed`: the device's one height, `--seq-h`; `natural`: the body's own, at the pane's width. */
  readonly fit: 'fixed' | 'natural';
  /** The card's own rail buttons, between the name and the region. */
  readonly tools?: readonly HTMLElement[];
  /** A smaller note after the kind's name on the rail. */
  readonly note?: string;
  /** A class of the card's own on the device, for its custom properties. */
  readonly className?: string;
}

/** What a sequencer card returns: a device body, or (a card not yet converted) its element. */
export type CardBody = HTMLElement | DeviceBody;

/** The device to draw: the part's kind and slot, the card's body, and the rail's region section. */
export interface DeviceFrame {
  readonly kind: SequencerKind;
  readonly slot: number;
  readonly card: CardBody;
  readonly region: RailRegion;
}

/** A card's body as a device's: a plain element is wrapped, at its natural height. */
function asDevice(card: CardBody): DeviceBody {
  if (!(card instanceof HTMLElement)) return card;
  const body = el('div', 'seq-device-body');
  body.appendChild(card);
  return { body, fit: 'natural' };
}

function setFolded(device: HTMLElement, name: HTMLElement | null, folded: boolean): void {
  device.classList.toggle('folded', folded);
  name?.setAttribute('aria-expanded', String(!folded));
}

/** The pane's row holding the part's device, its sizes set from `SEQUENCER_DEVICE_PX`. */
export function sequencerDevice(frame: DeviceFrame): HTMLElement {
  const content = asDevice(frame.card);
  const device = el('div', `seq-device ${content.fit}`);
  if (content.className) device.classList.add(content.className);
  device.style.setProperty('--kc', DEVICE_ACCENT[LANE_TONE[frame.kind]]);
  const rail = sequencerRail({
    name: KIND_LABELS[frame.kind],
    note: content.note,
    tools: content.tools,
    region: frame.region,
    fold: () => setFolded(device, name, DEVICE_FOLDS.toggle(frame.slot)),
  });
  const name = rail.querySelector<HTMLElement>('.seq-name');
  // A click anywhere on a folded device opens it, as on a folded insert; the rail's buttons still act.
  device.addEventListener('click', (e) => {
    if (!device.classList.contains('folded')) return;
    if (e.target instanceof Element && e.target.closest('button')) return;
    setFolded(device, name, DEVICE_FOLDS.toggle(frame.slot));
  });
  setFolded(device, name, DEVICE_FOLDS.isFolded(frame.slot));
  device.append(rail, content.body);
  const row = el('div', 'seq-rack');
  for (const [prop, px] of Object.entries(SEQUENCER_DEVICE_PX))
    row.style.setProperty(prop, `${px}px`);
  row.appendChild(device);
  return row;
}
