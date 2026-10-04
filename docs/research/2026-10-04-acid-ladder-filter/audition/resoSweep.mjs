/**
 * The makeup's performance case (windsor#587, decision 5): `acid-saw` on a
 * 2-bar A1 figure at the audition song's tempo and part velocity, its cutoff
 * held at 500 Hz (the filter envelope's amount 0, key track already 0),
 * while a song lane on `filter.resonance` takes the Reso knob from its floor
 * to its top and back over 4 bars, the figure played twice. The lane moves
 * the knob's travel evenly, p from 0 to 1 and back, the place the ladder's k
 * and the makeup follow (reso = 0.5 × 24^p, the knob's log scale), and steps
 * once per 128-frame block as a k-rate lane does. The figure is sixteen A1
 * sixteenths a bar, each released as the next starts: one pitch and one
 * velocity, so the level from window to window is the Reso's alone.
 *
 * `levelRange` reads the render in 100 ms windows over the 4 bars (the
 * release left out): each window's RMS in dBFS, the range between the
 * loudest and the quietest, and the windows at the floor (the first) and at
 * the top (the one that holds the turn).
 */
import { SR, renderEvents } from './bundleVariant.mjs';

const BARS = 4;
const STEPS_PER_BAR = 16;
const NOTE = 33;
const CUTOFF_HZ = 500;
const RESO_FLOOR = 0.5;
const RESO_SPAN = 24;
const TAIL_S = 0.5;
const WINDOW_S = 0.1;

/** The sweep's samples, mono, and the frame its last note is released. */
export function renderResoSweep(variant, patch, { bpm, velocity }) {
  const stepFrames = (SR * 60) / (bpm * 4);
  const steps = BARS * STEPS_PER_BAR;
  const events = [];
  for (let i = 0; i < steps; i++) {
    const frame = Math.round(i * stepFrames);
    if (i > 0) events.push({ type: 'noteOff', id: i, frame });
    events.push({ type: 'noteOn', id: i + 1, note: NOTE, velocity, frame });
  }
  const end = Math.round(steps * stepFrames);
  events.push({ type: 'noteOff', id: steps, frame: end });
  const held = {
    ...patch,
    filter: { ...patch.filter, cutoff: CUTOFF_HZ, envAmount: 0, keyTrack: 0, resonance: RESO_FLOOR },
  };
  const lanes = {
    paths: ['filter.resonance'],
    at(frame) {
      const t = Math.min(frame / end, 1);
      const place = t < 0.5 ? 2 * t : 2 - 2 * t;
      return [RESO_FLOOR * RESO_SPAN ** place - RESO_FLOOR];
    },
  };
  const samples = renderEvents(variant, held, events, { seconds: end / SR + TAIL_S, lanes });
  return { samples, end };
}

/** The sweep's level in 100 ms windows: `{ range, floor, top }` in dB. */
export function levelRange(samples, end) {
  const size = Math.round(WINDOW_S * SR);
  const levels = [];
  for (let at = 0; at + size <= end; at += size) {
    let sum = 0;
    for (let i = at; i < at + size; i++) sum += samples[i] * samples[i];
    levels.push(10 * Math.log10(sum / size));
  }
  const turn = Math.floor(end / 2 / size);
  return {
    range: Math.max(...levels) - Math.min(...levels),
    floor: levels[0],
    top: levels[turn],
  };
}
