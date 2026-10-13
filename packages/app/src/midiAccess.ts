/**
 * The console's Web MIDI connection (#523): asks for access, listens to the
 * selected input(s), follows hot-plugging, and remembers the choice by device
 * name. Messages go through `decodeMidi` into that input's own `MidiPerformer`,
 * stamped with their own `timeStamp` (windsor#663).
 * Whatever the connection stops hearing — a deselected or unplugged device —
 * has its notes and pedal released, so nothing sticks.
 *
 * A knob or fader (`decodeMidi`'s `cc` event) goes to the CC listener
 * instead (windsor#784, record `2026-10-13-midi-cc-mapping`), with its
 * input's name and channel; so does each input the connection starts
 * listening to again (plugged back in, or selected again), whose knobs may
 * have moved unheard. A lost or deselected input needs no word: a CC value
 * it set holds.
 */
import type { CcMessage } from './ccEngine';
import { INPUT_STORAGE_KEY } from './midiConstants';
import { ALL_INPUTS, listensTo, type InputInfo } from './midiInputs';
import { decodeMidi } from './midiMessage';
import { MidiPerformer, type PerformerSink } from './midiPerformer';

export type MidiState = 'unsupported' | 'off' | 'requesting' | 'denied' | 'ready';

/** Who hears the controllers: the console's CC session. */
export interface CcListener {
  hear(message: CcMessage): void;
  /** The connection listens to the input named `device` (null: unnamed) again, or for the first time. */
  listened(device: string | null): void;
}

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
  /** The controllers' listener (windsor#784); none until the console sets it. */
  cc: CcListener | null = null;

  private access: MIDIAccess | null = null;
  private listening = new Set<string>();
  private readonly watchers = new Set<() => void>();
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
        const device = input.name ?? null;
        input.onmidimessage = (e): void => {
          const event = e.data ? decodeMidi(e.data) : null;
          if (event?.type !== 'cc') {
            if (event) performer.handle(event, e.timeStamp);
            return;
          }
          const { channel, cc, value } = event;
          this.cc?.hear({ device, channel, cc, value });
        };
        if (!this.listening.has(input.id)) this.cc?.listened(device);
      } else {
        input.onmidimessage = null;
      }
    }
    for (const id of this.listening) if (!now.has(id)) this.performers.get(id)?.releaseAll();
    this.listening = now;
    this.changed();
  }

  /** Hear every change of state, inputs or selection, beside `onChange`; returns the unsubscribe. */
  watch(listener: () => void): () => void {
    this.watchers.add(listener);
    return () => void this.watchers.delete(listener);
  }

  private changed(): void {
    this.onChange?.();
    for (const watcher of this.watchers) watcher();
  }
}
