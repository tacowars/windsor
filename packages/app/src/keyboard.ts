/**
 * The audition keyboard (#70): plays the Parts tab's selected part through
 * the real engine — `part.noteOn`/`noteOff`, nothing local.
 */
import type { AudioPart } from '../../../packages/client/src/audio/index-for-editor';
import { $, el } from './dom';
import type { PerformerSink } from './midiPerformer';

const BLACK = new Set([1, 3, 6, 8, 10]);
const KEY_COUNT = 24;
/** What the QWERTY row and the mouse strike with; MIDI brings its own. */
const FIXED_VELOCITY = 0.9;
const QWERTY: Record<string, number> = {
  a: 0,
  w: 1,
  s: 2,
  e: 3,
  d: 4,
  f: 5,
  t: 6,
  g: 7,
  y: 8,
  h: 9,
  u: 10,
  j: 11,
  k: 12,
  o: 13,
  l: 14,
  p: 15,
};

/**
 * A dropdown picked with the mouse keeps focus, and the note keys above are
 * ignored inside a select (a letter there would change its value), so every
 * pick — wave, filter, preset category — cost a click away before auditioning.
 * A mouse pick now hands focus back; a keyboard user arrowing through the
 * options keeps it. Listboxes (`size` > 1) are left to their owners.
 */
function releaseMousePickedDropdowns(): void {
  let pickedByMouse = false;
  addEventListener(
    'pointerdown',
    (e) => {
      pickedByMouse = e.target instanceof HTMLSelectElement;
    },
    true,
  );
  addEventListener(
    'keydown',
    () => {
      pickedByMouse = false;
    },
    true,
  );
  addEventListener(
    'change',
    (e) => {
      const t = e.target;
      if (pickedByMouse && t instanceof HTMLSelectElement && !t.multiple && t.size <= 1) t.blur();
    },
    true,
  );
}

interface Held {
  id: number;
  part: AudioPart;
  el: HTMLElement | null;
}

export class Keyboard {
  octave = 4;
  hold = false;

  /** Called after Panic, so a MIDI performer can forget notes the part no longer sounds. */
  onPanic: (() => void) | null = null;

  private readonly held = new Map<string, Held>();
  private readonly getPart: () => AudioPart | null;
  /** The part carrying the controller's bend and wheel, and their positions. */
  private expressionPart: AudioPart | null = null;
  private bendSemitones = 0;
  private wheel = 0;

  constructor(getPart: () => AudioPart | null) {
    this.getPart = getPart;
  }

  /** Build the keys into `box` and wire the octave label. */
  render(box: HTMLElement): void {
    box.innerHTML = '';
    for (let i = 0; i < KEY_COUNT; i++) {
      const key = el('div', 'key');
      key.dataset.offset = String(i);
      if (BLACK.has(i % 12)) key.dataset.black = '1';
      key.addEventListener('pointerdown', (e) => {
        key.setPointerCapture(e.pointerId);
        this.press('mouse', i, key);
      });
      const up = (): void => this.lift('mouse');
      key.addEventListener('pointerup', up);
      key.addEventListener('pointercancel', up);
      box.appendChild(key);
    }
    this.syncLabel();
  }

  /** Global QWERTY handling; call once. */
  attachGlobalKeys(): void {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const tag = (e.target instanceof HTMLElement ? e.target.tagName : '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.key === 'z') return this.shiftOctave(-1);
      if (e.key === 'x') return this.shiftOctave(1);
      const off = QWERTY[e.key];
      if (off === undefined || this.held.has(e.key)) return;
      this.press(e.key, off, ($('keys').children[off] as HTMLElement | undefined) ?? null);
    });
    addEventListener('keyup', (e) => this.lift(e.key));
    releaseMousePickedDropdowns();
  }

  shiftOctave(by: number): void {
    this.octave = Math.min(8, Math.max(0, this.octave + by));
    this.syncLabel();
  }

  panic(): void {
    this.getPart()?.panic();
    this.held.clear();
    document.querySelectorAll('.key.down').forEach((k) => k.classList.remove('down'));
    this.bendSemitones = 0;
    this.wheel = 0;
    this.followPart();
    this.onPanic?.();
  }

  /**
   * Hand the controller's bend and wheel to the selected part: the part that
   * had them returns to rest, the new one takes the current positions. The
   * part picker calls this on a switch; every expression change does too.
   */
  followPart(): void {
    const part = this.getPart();
    if (this.expressionPart && this.expressionPart !== part) {
      this.expressionPart.pitchBend.value = 0;
      this.expressionPart.modWheel.value = 0;
    }
    this.expressionPart = part;
    if (part) {
      part.pitchBend.value = this.bendSemitones;
      part.modWheel.value = this.wheel;
    }
  }

  /** One MIDI input's view of this keyboard: real note numbers, real velocity, its own held notes. */
  midiSink(inputId: string): PerformerSink {
    return {
      press: (note, velocity) => {
        const offset = note - this.octave * 12;
        const keys = document.getElementById('keys');
        const keyEl = offset >= 0 && offset < KEY_COUNT ? keys?.children[offset] : undefined;
        const el = (keyEl as HTMLElement | undefined) ?? null;
        this.play(`midi:${inputId}:${note}`, note, velocity, el);
      },
      release: (note, force) => this.lift(`midi:${inputId}:${note}`, force),
      bend: (semitones) => {
        this.bendSemitones = semitones;
        this.followPart();
      },
      modWheel: (value) => {
        this.wheel = value;
        this.followPart();
      },
    };
  }

  private press(source: string, offset: number, keyEl: HTMLElement | null): void {
    this.play(source, this.octave * 12 + offset, FIXED_VELOCITY, keyEl);
  }

  private play(source: string, note: number, velocity: number, keyEl: HTMLElement | null): void {
    const part = this.getPart();
    if (!part) return;
    const id = part.noteOn(note, velocity);
    keyEl?.classList.add('down');
    this.held.set(source, { id, part, el: keyEl });
  }

  private lift(source: string, force = false): void {
    const held = this.held.get(source);
    if (!held) return;
    if (!this.hold || force) held.part.noteOff(held.id);
    held.el?.classList.remove('down');
    this.held.delete(source);
  }

  private syncLabel(): void {
    const label = document.getElementById('octLabel');
    if (label) label.textContent = `C${this.octave}`;
  }
}
