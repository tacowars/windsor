/* global structuredClone */
/**
 * windsor#652's renders: each candidate's bundle under Node, through
 * `2026-10-09-operator-hard-sync/workletBundle.mjs`'s harness, at its own
 * rate, brought to 48 kHz and aligned in time. Research only.
 *
 * A variant is a name from `VARIANTS`. Each output is the left channel at
 * 48 kHz with the variant's own delay taken out (a sample for A, two for C;
 * the decimators of B and the reference are applied zero phase, so their
 * group delay, which `response.mjs` states, is not in the render), so sample
 * m of every variant is the same instant.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bundleText,
  heldPart,
  renderBlocks,
} from '../2026-10-09-operator-hard-sync/workletBundle.mjs';
import { direct, fineRatio, scaledIntervals } from './candidates.mjs';
import { DECIMATORS, decimate } from './decimators.mjs';

export const SR = 48000;
const BLOCK = 128;

/**
 * Every variant: its bundle edit, its rate factor, its decimator, and the
 * samples it runs late at its own rate. `+D` adds candidate D to any of them.
 */
const BASE = {
  shipped: { edit: (t) => t, factor: 1, late: 0 },
  A: { edit: (t) => direct(t, 2), factor: 1, late: 1 },
  C: { edit: (t) => direct(t, 4), factor: 1, late: 2 },
  B2: { edit: (t) => scaledIntervals(t, 2), factor: 2, chain: 'B2' },
  B4: { edit: (t) => scaledIntervals(t, 4), factor: 4, chain: 'B4' },
  ref16: { edit: (t) => t, factor: 16, chain: 'REF16' },
  ref16s: { edit: (t) => scaledIntervals(t, 16), factor: 16, chain: 'REF16' },
  /** Exploratory, past the issue's list: A's direct shape inside B's 2× voice. */
  AB2: { edit: (t) => direct(scaledIntervals(t, 2), 2), factor: 2, chain: 'B2', late: 1 },
};

/** The variant named `name` (`A`, `A+D`, `B4+D`, …): its bundle text, rate and alignment. */
export function variant(repo, name) {
  const [base, d] = name.split('+');
  const spec = BASE[base];
  if (!spec || (d !== undefined && d !== 'D')) throw new Error(`no variant "${name}"`);
  let text = spec.edit(bundleText(repo));
  if (d === 'D') text = fineRatio(text);
  const stages = spec.chain ? DECIMATORS[spec.chain] : [];
  // The decimators are applied zero phase (`decimators.mjs`), so only the
  // direct shape's own samples are late, at the variant's rate.
  const late = spec.late ?? 0;
  return { name, text, factor: spec.factor, rate: SR * spec.factor, stages, late };
}

/** The processor class from a bundle's text at `rate`, and a setter for its block's start frame. */
export function processorWithClock(text, rate) {
  let Processor = null;
  class PortShim {
    constructor() {
      this.port = { postMessage() {}, onmessage: null };
    }
    inbox(message) {
      this.port.onmessage?.({ data: message });
    }
  }
  const setFrame = new Function(
    'sampleRate',
    'AudioWorkletProcessor',
    'registerProcessor',
    `let currentFrame = 0; ${text}; return (f) => { currentFrame = f; };`,
  )(rate, PortShim, (_name, cls) => {
    Processor = cls;
  });
  return { Processor, setFrame };
}

const CLASSES = new Map();

/** A variant's processor class, built once. */
function classOf(v) {
  if (!CLASSES.has(v.name)) CLASSES.set(v.name, processorWithClock(v.text, v.rate));
  return CLASSES.get(v.name);
}

/**
 * The left channel of one note at `note` on `patch`, `seconds` long at
 * 48 kHz, through variant `v`: held throughout, or released at `offAt`
 * seconds. Aligned: the variant's lateness taken out.
 */
export function renderNote(v, patch, note, seconds, offAt = null) {
  const { Processor, setFrame } = classOf(v);
  const out48 = Math.ceil(seconds * SR);
  const need = out48 * v.factor + v.late + v.stages.reduce((n, s) => n + s.h.length, 0) * 2;
  const raw = new Float64Array(Math.ceil(need / BLOCK) * BLOCK);
  const processor = heldPart(Processor, structuredClone(patch), note);
  if (offAt !== null) {
    processor.inbox({ type: 'noteOff', id: 1, frame: Math.round(offAt * v.rate) });
  }
  renderBlocks(processor, raw.length / BLOCK, (left, b) => {
    raw.set(left, b * BLOCK);
    setFrame((b + 1) * BLOCK);
  });
  const aligned = raw.subarray(v.late);
  const at48 = v.stages.length ? decimate(aligned, v.stages) : aligned;
  return at48.slice(0, out48);
}

/** A patch from the library by id. */
export const library = (repo, id) =>
  JSON.parse(readFileSync(join(repo, 'packages/engine/src/patches', `${id}.json`), 'utf8')).patch;

/** The frequency of MIDI `note`. */
export const noteHz = (note) => 440 * 2 ** ((note - 69) / 12);
