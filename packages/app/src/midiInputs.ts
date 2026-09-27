/**
 * Which MIDI inputs the console listens to (#523), without Web MIDI: tacowars often
 * has two or three class-compliant devices connected and plays one. The
 * selection is a device name (ids are not promised stable across sessions) or
 * `ALL_INPUTS`; a remembered device that is not connected stays selected and
 * silent, and resumes when it comes back.
 */

export const ALL_INPUTS = '';

export interface InputInfo {
  name: string;
  connected: boolean;
}

export interface InputOption {
  value: string;
  label: string;
}

/** Does the selection take messages from this input? */
export function listensTo(input: InputInfo, selection: string): boolean {
  return input.connected && (selection === ALL_INPUTS || input.name === selection);
}

/** The selector's entries: all, each connected input once, and a remembered absent one. */
export function inputOptions(inputs: readonly InputInfo[], selection: string): InputOption[] {
  const names = [...new Set(inputs.filter((i) => i.connected).map((i) => i.name))];
  const options: InputOption[] = [
    { value: ALL_INPUTS, label: 'All inputs' },
    ...names.map((name) => ({ value: name, label: name })),
  ];
  if (selection !== ALL_INPUTS && !names.includes(selection)) {
    options.push({ value: selection, label: `${selection} (disconnected)` });
  }
  return options;
}

/** A one-line status for what the selection is actually hearing. */
export function listeningLabel(inputs: readonly InputInfo[], selection: string): string {
  const live = inputs.filter((i) => listensTo(i, selection));
  if (live.length === 0) {
    return selection === ALL_INPUTS
      ? 'MIDI: no inputs connected'
      : `MIDI: waiting for ${selection}`;
  }
  return `MIDI: ${live.map((i) => i.name).join(', ')}`;
}
