/**
 * One timbral part: a single `AudioWorkletNode` running its own polyphonic
 * voice pool and patch.
 *
 * Deliberately one node per *part*, never per voice. Each node carries fixed
 * overhead, so 8-16 internally-polyphonic parts is the shape -- each with its
 * own native effect chain -- rather than a node per sounding note.
 */
import type { Patch } from './patch';
import type { ScheduledMessage, WorkletMessage } from './workletMessages';
import { frameForTime } from './workletMessages';

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
  private readonly heldByNote = new Map<number, number[]>();

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
    this.post(message);
  }

  /**
   * Start a note. Omit `time` for "as soon as possible"; pass a context time to
   * place it exactly, which is what the scheduler does.
   *
   * @returns a handle for `noteOff`.
   */
  noteOn(note: number, velocity = 1, time?: number): number {
    const id = this.nextId++;
    this.schedule({
      type: 'noteOn',
      id,
      note,
      velocity,
      frame: frameForTime(this.context, time ?? this.context.currentTime),
    });
    const ids = this.heldByNote.get(note);
    if (ids) ids.push(id);
    else this.heldByNote.set(note, [id]);
    return id;
  }

  /** Release a note by the handle `noteOn` returned. */
  noteOff(handle: number, time?: number): void {
    this.schedule({
      type: 'noteOff',
      id: handle,
      frame: frameForTime(this.context, time ?? this.context.currentTime),
    });
  }

  /** Release the oldest sounding instance of a note number (MIDI-style). */
  noteOffByNote(note: number, time?: number): void {
    const ids = this.heldByNote.get(note);
    const id = ids?.shift();
    if (id === undefined) return;
    if (ids && ids.length === 0) this.heldByNote.delete(note);
    this.noteOff(id, time);
  }

  /** Fire and forget: a note of fixed length. The shape most game SFX want. */
  trigger(note: number, velocity = 1, duration = 0.25, time?: number): number {
    const start = time ?? this.context.currentTime;
    const id = this.noteOn(note, velocity, start);
    this.noteOff(id, start + duration);
    return id;
  }

  allNotesOff(): void {
    this.post({ type: 'allNotesOff' });
    this.heldByNote.clear();
  }

  /** Hard stop with no release tails. Clicks; for scene teardown, not gameplay. */
  panic(): void {
    this.post({ type: 'panic' });
    this.heldByNote.clear();
  }

  /**
   * Swap the patch. Voices already sounding keep the old one until they finish,
   * so turning a knob mid-note does not click.
   */
  setPatch(patch: Patch): void {
    this.patchValue = patch;
    this.post({ type: 'patch', patch: structuredClone(patch) });
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
