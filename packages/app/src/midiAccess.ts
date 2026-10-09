/**
 * The console's Web MIDI connection (#523): asks for access, listens to the
 * selected input(s), follows hot-plugging, and remembers the choice by device
 * name. Messages go through `decodeMidi` into that input's own `MidiPerformer`,
 * stamped with their own `timeStamp` (windsor#663).
 * Whatever the connection stops hearing — a deselected or unplugged device —
 * has its notes and pedal released, so nothing sticks.
 */
import { INPUT_STORAGE_KEY } from './midiConstants';
import { ALL_INPUTS, listensTo, type InputInfo } from './midiInputs';
import { decodeMidi } from './midiMessage';
import { MidiPerformer, type PerformerSink } from './midiPerformer';

export type MidiState = 'unsupported' | 'off' | 'requesting' | 'denied' | 'ready';

const readSelection = (): string => {
  try {
    return localStorage.getItem(INPUT_STORAGE_KEY) ?? ALL_INPUTS;
  } catch {
    return ALL_INPUTS;
  }
};

const writeSelection = (name: string): void => {
  try {
    localStorage.setItem(INPUT_STORAGE_KEY, name);
  } catch {
    // Storage blocked (private window, file:// policy): the choice lasts this session.
  }
};

export class MidiAccessor {
  state: MidiState = 'requestMIDIAccess' in navigator ? 'off' : 'unsupported';
  selection = readSelection();
  error = '';
  /** The panel's redraw; one slot, because the Parts tab rebuilds its panel. */
  onChange: (() => void) | null = null;

  private access: MIDIAccess | null = null;
  private listening = new Set<string>();
  private readonly performers = new Map<string, MidiPerformer>();

  /** `sinkFor` gives each input its own place to play into, by input id. */
  constructor(private readonly sinkFor: (inputId: string) => PerformerSink) {}

  /** Connect without a prompt when this origin already holds the MIDI permission. */
  async resume(): Promise<void> {
    if (this.state !== 'off' || !navigator.permissions) return;
    try {
      const permission = await navigator.permissions.query({ name: 'midi' as PermissionName });
      if (permission.state === 'granted') await this.enable();
    } catch {
      // A browser without the 'midi' permission name: wait for the button.
    }
  }

  /** Ask for MIDI access (Chrome prompts the first time). */
  async enable(): Promise<void> {
    if (this.state === 'unsupported' || this.state === 'requesting' || this.access) return;
    this.state = 'requesting';
    this.changed();
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = (): void => this.attach();
      this.state = 'ready';
      this.attach();
    } catch (error) {
      this.state = 'denied';
      this.error = error instanceof Error ? error.message : String(error);
      this.changed();
    }
  }

  /** Panic silenced the part: drop the performer's notes and pedal without re-releasing them. */
  forgetNotes(): void {
    for (const performer of this.performers.values()) performer.forget();
  }

  private performer(inputId: string): MidiPerformer {
    let performer = this.performers.get(inputId);
    if (!performer) {
      performer = new MidiPerformer(this.sinkFor(inputId));
      this.performers.set(inputId, performer);
    }
    return performer;
  }

  inputs(): InputInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((input) => ({
      name: input.name ?? input.id,
      connected: input.state === 'connected',
    }));
  }

  select(selection: string): void {
    if (selection === this.selection) return;
    this.selection = selection;
    writeSelection(selection);
    this.attach();
  }

  /** Point every input's handler at the performer, or away from it; release what was lost. */
  private attach(): void {
    if (!this.access) return;
    const now = new Set<string>();
    for (const input of this.access.inputs.values()) {
      const info = { name: input.name ?? input.id, connected: input.state === 'connected' };
      if (listensTo(info, this.selection)) {
        now.add(input.id);
        const performer = this.performer(input.id);
        input.onmidimessage = (e): void => {
          const event = e.data ? decodeMidi(e.data) : null;
          if (event) performer.handle(event, e.timeStamp);
        };
      } else {
        input.onmidimessage = null;
      }
    }
    for (const id of this.listening) if (!now.has(id)) this.performers.get(id)?.releaseAll();
    this.listening = now;
    this.changed();
  }

  private changed(): void {
    this.onChange?.();
  }
}
