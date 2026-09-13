/**
 * The keyboard bar's MIDI controls (#523): an enable button until access is
 * granted, then the input selector and what it is hearing. Rebuilt with the
 * Parts tab; the connection itself lives in `main.ts` and outlives it.
 */
import { el } from './dom';
import type { MidiAccessor } from './midiAccess';
import { inputOptions, listeningLabel } from './midiInputs';

const STATE_TEXT: Record<string, string> = {
  unsupported: 'MIDI: not supported in this browser (use Chrome or Edge)',
  requesting: 'MIDI: waiting for permission…',
};

export function midiPanel(midi: MidiAccessor): HTMLElement {
  const box = el('div', 'midi-panel');
  const render = (): void => {
    box.replaceChildren();
    if (midi.state === 'off' || midi.state === 'denied') {
      const enable = el('button', 'btn', 'Enable MIDI') as HTMLButtonElement;
      enable.type = 'button';
      enable.onclick = (): void => void midi.enable();
      box.appendChild(enable);
      if (midi.state === 'denied') {
        box.appendChild(
          el('span', 'status', `MIDI: access refused${midi.error ? ` (${midi.error})` : ''}`),
        );
      }
      return;
    }
    if (midi.state !== 'ready') {
      box.appendChild(el('span', 'status', STATE_TEXT[midi.state] ?? ''));
      return;
    }
    const inputs = midi.inputs();
    const picker = document.createElement('select');
    picker.className = 'field';
    picker.setAttribute('aria-label', 'MIDI input');
    for (const option of inputOptions(inputs, midi.selection)) {
      picker.add(new Option(option.label, option.value));
    }
    picker.value = midi.selection;
    picker.onchange = (): void => midi.select(picker.value);
    const status = el('span', 'status');
    status.textContent = listeningLabel(inputs, midi.selection);
    box.append(picker, status);
  };
  midi.onChange = render;
  render();
  return box;
}
