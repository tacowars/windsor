/**
 * The audition keyboard (#70): plays the Parts tab's selected part through
 * the real engine — `part.noteOn`/`noteOff`, nothing local. Its QWERTY keys
 * play only while the Parts tab is shown (windsor#349), so another tab's own
 * keys (the Song tab's E and D) never sound a note; MIDI input plays anywhere.
 */
import type { AudioPart } from '@windsor/engine';
import { SEMITONES_PER_OCTAVE } from '@windsor/engine';
import { $, el } from './dom';
import {
  AUDITION_TAB,
  BLACK_KEYS,
  FIXED_VELOCITY,
  KEY_COUNT,
  OCTAVE_DEFAULT,
  OCTAVE_MAX,
  OCTAVE_MIN,
  QWERTY,
} from './keyboardConstants';
import { pitchClass } from './consoleFormat';
import type { PerformerSink } from './midiPerformer';

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

/** Whether the QWERTY keys play while `activeTab` is shown: only on the audition tab. */
export const qwertyPlaysOn = (activeTab: string | null, auditionTab = AUDITION_TAB): boolean =>
  activeTab === auditionTab;

/**
 * Whether a press is a shortcut rather than a note: anything held with Ctrl,
 * Meta or Alt. ⌘K opening the patch search used to strike the `k` key's C
 * as well (windsor#521), and Ctrl+Z shifted the octave; no chord plays.
 * Shift is left alone: it changes `e.key`, and a shifted letter maps to no key.
 */
export const isShortcutPress = (
  e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>,
): boolean => e.ctrlKey || e.metaKey || e.altKey;

interface Held {
  id: number;
  part: AudioPart;
  el: HTMLElement | null;
}

export class Keyboard {
  octave = OCTAVE_DEFAULT;
  hold = false;

  /** Called after Panic, so a MIDI performer can forget notes the part no longer sounds. */
  onPanic: (() => void) | null = null;

  private readonly held = new Map<string, Held>();
  /**
   * Every part this keyboard has struck a note on since the last Panic (#617).
   * `held` is not enough: under Hold a keyup drops the entry without a
   * `noteOff`, so the note lives on the engine alone and no map remembers
   * which part is carrying it.
   */
  private readonly sounded = new Set<AudioPart>();
  private readonly getPart: () => AudioPart | null;
  /** Whether a QWERTY press plays now; a release always lifts its note. */
  private readonly qwertyLive: () => boolean;
  /** The part carrying the controller's bend and wheel, and their positions. */
  private expressionPart: AudioPart | null = null;
  private bendSemitones = 0;
  private wheel = 0;

  constructor(getPart: () => AudioPart | null, qwertyLive: () => boolean = () => true) {
    this.getPart = getPart;
    this.qwertyLive = qwertyLive;
  }

  /** How many notes the keyboard is holding; what Panic must leave at zero. */
  get heldCount(): number {
    return this.held.size;
  }

  /** Build the keys into `box` and wire the octave label. */
  render(box: HTMLElement): void {
    box.innerHTML = '';
    for (let i = 0; i < KEY_COUNT; i++) {
      const key = el('div', 'key');
      key.dataset.offset = String(i);
      if (BLACK_KEYS.has(pitchClass(i))) key.dataset.black = '1';
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
    addEventListener('keydown', (e) => this.onKeyDown(e));
    addEventListener('keyup', (e) => this.onKeyUp(e));
    releaseMousePickedDropdowns();
  }

  /**
   * One QWERTY press. The note comes from `e.key` — the letter printed on the
   * key — but the held note is filed under `e.code`, the physical key (#617):
   * press `a`, take Shift to fine-drag a knob, release, and the keyup arrives
   * as `A`. Keyed by `e.key` that release found nothing to lift, the note rang
   * on, and every later `a` returned early because the map still held it.
   */
  onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || isShortcutPress(e) || !this.qwertyLive()) return;
    const tag = (e.target instanceof HTMLElement ? e.target.tagName : '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    // A modal's buttons are not keys either (#563): focus is trapped there until it closes.
    if (e.target instanceof HTMLElement && e.target.closest('dialog[open]')) return;
    if (e.key === 'z') return this.shiftOctave(-1);
    if (e.key === 'x') return this.shiftOctave(1);
    const off = QWERTY[e.key];
    if (off === undefined || this.held.has(e.code)) return;
    this.press(e.code, off, ($('keys').children[off] as HTMLElement | undefined) ?? null);
  }

  /** One QWERTY release, by physical key so a Shift change between the two still lifts. */
  onKeyUp(e: KeyboardEvent): void {
    this.lift(e.code);
  }

  shiftOctave(by: number): void {
    this.octave = Math.min(OCTAVE_MAX, Math.max(OCTAVE_MIN, this.octave + by));
    this.syncLabel();
  }

  /**
   * Silence every part this keyboard has sounded, not just the selected one
   * (#617): under Hold a note lives on the engine with nothing left to
   * release it, so switching parts used to strand it — Panic reached the new
   * part while the old one rang on. Hold keeps the latched notes across a
   * part switch, which is what Hold is for; Panic is what lets them all go.
   */
  panic(): void {
    const selected = this.getPart();
    if (selected) this.sounded.add(selected);
    for (const part of this.sounded) part.panic();
    this.sounded.clear();
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
   * selection's listener calls this on every switch, from either view
   * (`ctx.parts.onSelect`, wired in `main.ts`); every expression change
   * does too.
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
        const offset = note - this.octave * SEMITONES_PER_OCTAVE;
        const keys = document.getElementById('keys');
        const keyEl = offset >= 0 && offset < KEY_COUNT ? keys?.children[offset] : undefined;
        this.play(
          `midi:${inputId}:${note}`,
          note,
          velocity,
          (keyEl as HTMLElement | undefined) ?? null,
        );
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
    this.play(source, this.octave * SEMITONES_PER_OCTAVE + offset, FIXED_VELOCITY, keyEl);
  }

  private play(source: string, note: number, velocity: number, keyEl: HTMLElement | null): void {
    const part = this.getPart();
    if (!part) return;
    const id = part.noteOn(note, velocity);
    this.sounded.add(part);
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
