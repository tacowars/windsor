/* global structuredClone */
/** The load cases: version-15 song documents built in the page from the shipped patches.
 * Every part is a Chord Player hitting one three-note chord a bar and holding it (gate 1),
 * at 120 BPM: a new chord every 2 s. `pad-drift`'s operators release over 2.4 s, so the
 * previous chord's voices are still releasing when the next one strikes: a part carries
 * its three new voices plus the last chord's three in release for most of each bar (six
 * voices a part, twelve with the patch's own `spread`, each pair dropping out as the tail
 * goes dormant), not a fixed three. The load is a steady one per part, not a fixed voice
 * count. The harmony moves every four bars. `silent` parts have no sequencer, so their
 * processors run with every voice inactive: the graph alone.
 */
import padDrift from '../../../packages/engine/src/patches/pad-drift.json' with { type: 'json' };

const TICKS_PER_BAR = 96;
const BARS_PER_CHORD = 4;
const DEGREES = [0, 5, 3, 4];

/** Every insert kind the registry holds, in the order a "heavy" strip rotates through. */
export const KINDS = [
  'eq',
  'compressor',
  'delay',
  'filter',
  'phaser',
  'tape',
  'advanced-drive',
  'reverb',
  'retro-reverb',
  'chorus',
  'ensemble',
  'drive',
  'echo',
  'bloom',
];

function harmony(bars) {
  const span = BARS_PER_CHORD * TICKS_PER_BAR;
  const events = [];
  for (let start = 0; start < bars * TICKS_PER_BAR; start += span) {
    events.push({ start, duration: span, degree: DEGREES[events.length % 4], size: 3 });
  }
  return { root: 0, scale: 'naturalMinor', events };
}

function part(slot, bars, { inserts, sends, silent }) {
  return {
    slot,
    name: `Part ${slot + 1}`,
    preset: 'pad-drift',
    velocity: 0.8,
    strip: { level: 0.5, pan: ((slot % 5) - 2) / 4, lowCut: 20, sends, inserts },
    regions: [{ start: 0, duration: bars * TICKS_PER_BAR }],
    sequencer: silent
      ? { kind: 'none' }
      : {
          kind: 'chord',
          divisor: TICKS_PER_BAR,
          gate: 1,
          voicing: 'close',
          register: { octave: 3 },
          steps: [{ kind: 'hit', inversion: 0, octave: 0, duration: 1, repeat: 1 }],
          follow: false,
        },
  };
}

/**
 * A song of `parts` parts over `bars` bars at 120 BPM.
 *   inserts: how many a strip carries (rotating through KINDS, offset by slot);
 *   sends: whether every strip sends to both returns;
 *   master: inserts on the song master;
 *   spread: the patch's own spread (6 voices a chord) or 0 (3);
 *   silent: no notes at all.
 */
export function song(name, { parts, bars = 8, inserts = 0, sends = false, master = [], spread = 0, silent = false }) {
  const patch = structuredClone(padDrift.patch);
  patch.spread = spread;
  const list = [];
  for (let slot = 0; slot < parts; slot++) {
    const own = [];
    for (let i = 0; i < inserts; i++) own.push({ kind: KINDS[(slot * inserts + i) % KINDS.length] });
    list.push(part(slot, bars, { inserts: own, sends: sends ? { a: 0.3, b: 0.2 } : {}, silent }));
  }
  return {
    name,
    document: {
      version: 15,
      transport: { bpm: 120, bars },
      harmony: harmony(bars),
      parts: list,
      patches: { 'pad-drift': patch },
      master: { level: 1, inserts: master.map((kind) => ({ kind })) },
    },
  };
}

/** The offline render cases, in one round's order. */
export const OFFLINE_CASES = [
  song('16-silent', { parts: 16, silent: true }),
  song('16-silent-3ins', { parts: 16, silent: true, inserts: 3, sends: true }),
  song('1-none', { parts: 1 }),
  song('4-none', { parts: 4 }),
  song('8-none', { parts: 8 }),
  song('16-none', { parts: 16 }),
  song('16-spread', { parts: 16, spread: 12 }),
  song('16-sends', { parts: 16, sends: true }),
  song('16-1ins', { parts: 16, inserts: 1, sends: true }),
  song('16-3ins', { parts: 16, inserts: 3, sends: true, master: ['eq', 'compressor'] }),
  song('8-3ins', { parts: 8, inserts: 3, sends: true, master: ['eq', 'compressor'] }),
];

/** The realtime trace cases. */
export const LIVE_CASES = ['16-none', '16-sends', '16-1ins', '16-3ins', '8-3ins'];

/** One insert kind alone on 16 silent-input strips: the kind's cost with no signal. */
export const KIND_CASES = KINDS.map((kind) => ({
  name: `kind-${kind}`,
  kind,
}));
