/**
 * One timbral part: a single `AudioWorkletNode` running its own polyphonic
 * voice pool and patch.
 *
 * Deliberately one node per *part*, never per voice. Each node carries fixed
 * overhead, so 8-16 internally-polyphonic parts is the shape -- each with its
 * own native effect chain -- rather than a node per sounding note.
 */
import type { Patch } from '../patch/patch';
import type { NoteOnMessage, ScheduledMessage, WorkletMessage } from './workletMessages';
import { frameForTime } from './workletMessages';

/** What a grid note carries beyond pitch and velocity (#602). */
export interface NoteExtras {
  /** Per-note mod, added to the wheel for this voice; 0 or absent for a plain note. */
  mod?: number;
  /** Take over the held voice legato (mono patches); otherwise an ordinary note-on. */
  slide?: boolean;
}

export class AudioPart {
  readonly name: string;
  readonly node: AudioWorkletNode;

  /** Tail of this part's chain. Connect this onward, not `node`. */
  readonly output: AudioNode;

  readonly pitchBend: AudioParam;
  readonly modWheel: AudioParam;
  readonly cutoffMod: AudioParam;
  readonly gain: AudioParam;

  private patchValue: Patch;
  private nextId = 1;
  /** note -> live handles, oldest first. Both maps are kept in step by forget(). */
  private readonly heldByNote = new Map<number, number[]>();
  private readonly noteByHandle = new Map<number, number>();
  /** Note messages kept back instead of posted while held (`holdNotes`); null when not. */
  private held: ScheduledMessage[] | null = null;

  constructor(name: string, node: AudioWorkletNode, patch: Patch) {
    this.name = name;
    this.node = node;
    this.output = node;
    this.patchValue = patch;

    this.pitchBend = requireParam(node, 'pitchBend');
    this.modWheel = requireParam(node, 'modWheel');
    this.cutoffMod = requireParam(node, 'cutoffMod');
    this.gain = requireParam(node, 'gain');
  }

  get patch(): Patch {
    return this.patchValue;
  }

  get context(): BaseAudioContext {
    return this.node.context;
  }

  private post(message: WorkletMessage): void {
    this.node.port.postMessage(message);
  }

  private schedule(message: ScheduledMessage): void {
    if (this.held) this.held.push(message);
    else this.post(message);
  }

  /**
   * Keep every note message from now on instead of posting it, until
   * `takeHeldNotes`. An offline render plays its opening this way
   * (windsor#40): a port message is asynchronous and loses the race against
   * `OfflineAudioContext.startRendering()`, so the opening's notes go to the
   * processor at construction instead (`PartOptions.events`).
   */
  holdNotes(): void {
    this.held ??= [];
  }

  /** Stop holding and hand back the note messages held, oldest first. */
  takeHeldNotes(): ScheduledMessage[] {
    const held = this.held ?? [];
    this.held = null;
    return held;
  }

  /**
   * Start a note. Omit `time` for "as soon as possible"; pass a context time to
   * place it exactly, which is what the scheduler does.
   *
   * `extras` carries a grid step's accent mod and slide flag (#602).
   *
   * @returns a handle for `noteOff`.
   */
  noteOn(note: number, velocity = 1, time?: number, extras?: NoteExtras): number {
    const id = this.nextId++;
    const message: NoteOnMessage = {
      type: 'noteOn',
      id,
      note,
      velocity,
      frame: frameForTime(this.context, time ?? this.context.currentTime),
    };
    if (extras?.mod !== undefined && extras.mod !== 0) message.mod = extras.mod;
    if (extras?.slide) message.slide = true;
    this.schedule(message);
    const ids = this.heldByNote.get(note);
    if (ids) ids.push(id);
    else this.heldByNote.set(note, [id]);
    this.noteByHandle.set(id, note);
    return id;
  }

  /**
   * Release a note by the handle `noteOn` returned.
   *
   * The handle is dropped from the note lookup here, not just scheduled: a
   * caller that mixes this with `noteOffByNote` would otherwise release an
   * already-finished handle and leave the newer note sounding.
   */
  noteOff(handle: number, time?: number): void {
    this.forget(handle);
    this.schedule({
      type: 'noteOff',
      id: handle,
      frame: frameForTime(this.context, time ?? this.context.currentTime),
    });
  }

  /** Release the oldest sounding instance of a note number (MIDI-style). */
  noteOffByNote(note: number, time?: number): void {
    const id = this.heldByNote.get(note)?.[0];
    if (id === undefined) return;
    this.noteOff(id, time);
  }

  /** Handles still sounding for a note, oldest first. Test and debug seam. */
  heldHandles(note: number): readonly number[] {
    return this.heldByNote.get(note) ?? [];
  }

  private forget(handle: number): void {
    const note = this.noteByHandle.get(handle);
    if (note === undefined) return;
    this.noteByHandle.delete(handle);
    const ids = this.heldByNote.get(note);
    if (!ids) return;
    const index = ids.indexOf(handle);
    if (index >= 0) ids.splice(index, 1);
    if (ids.length === 0) this.heldByNote.delete(note);
  }

  /** Fire and forget: a note of fixed length. The shape an audition or a one-shot wants. */
  trigger(note: number, velocity = 1, duration = 0.25, time?: number): number {
    const start = time ?? this.context.currentTime;
    const id = this.noteOn(note, velocity, start);
    this.noteOff(id, start + duration);
    return id;
  }

  allNotesOff(): void {
    this.post({ type: 'allNotesOff' });
    this.heldByNote.clear();
    this.noteByHandle.clear();
  }

  /** Hard stop with no release tails. Clicks; for teardown, not playback. */
  panic(): void {
    this.post({ type: 'panic' });
    this.heldByNote.clear();
    this.noteByHandle.clear();
  }

  /**
   * Swap the patch. Voices already sounding keep the old one until they finish,
   * so turning a knob mid-note does not click.
   */
  setPatch(patch: Patch): void {
    this.patchValue = patch;
    this.post({ type: 'patch', patch: structuredClone(patch) });
  }

  /**
   * Make later `setPatch` calls reach the voices already sounding too. The
   * console's knobs want this; song playback leaves it off (`LiveRetuneMessage`).
   */
  setLiveRetune(enabled: boolean): void {
    this.post({ type: 'liveRetune', enabled });
  }

  connect(destination: AudioNode): void {
    this.output.connect(destination);
  }

  dispose(): void {
    this.panic();
    this.post({ type: 'stop' });
    this.output.disconnect();
  }
}

function requireParam(node: AudioWorkletNode, name: string): AudioParam {
  const param = node.parameters.get(name);
  if (!param) {
    throw new Error(`fm-part worklet exposes no "${name}" parameter -- worklet and host disagree`);
  }
  return param;
}
