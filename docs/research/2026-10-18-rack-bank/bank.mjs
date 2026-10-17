/**
 * The first built-in rack bank's recipes (windsor#878): what each rack is
 * made of, and where every value comes from. `author.mjs` turns them into
 * `packages/engine/src/racks/<id>.json` through the engine's own loader and
 * serialiser. Each insert is a shipped starting point (`*PresetTables.ts`,
 * the Reverb's bank) or its kind's defaults; a value set by hand is named in
 * `hand` and explained in the rack's description, and the README tables it.
 *
 * Patterns are 16 sixteenths unless said; `x` is a hit.
 */

/** A 16-step trigger row from a string of `x` and `.`. */
const row = (text) => [...text].map((c) => c === 'x');

/** A Basslead or Arp cell: `n` a note, `r` a rest; `+` an octave up, `A` an accent, `S` a slide. */
function cell(text) {
  if (text === 'r') return { kind: 'rest' };
  return {
    kind: 'note',
    octave: text.includes('+') ? 1 : 0,
    accent: text.includes('A'),
    slide: text.includes('S'),
  };
}

/** A Euclid part playing a captured row on the fitted pitch (C4, where the drum patches are fitted). */
const euclid = (pattern) => ({
  kind: 'euclidean',
  note: 60,
  hold: 0.1,
  steps: 16,
  divisor: 6,
  pulses: { min: 3, max: 9, start: 5 },
  rotate: 0,
  density: { kind: 'lfoBars', bars: 8, shape: 'tri' },
  pattern: row(pattern),
});

const drivenKick = (m) => ({
  id: 'driven-kick',
  name: 'Driven Kick',
  patchSource: 'tr909-kick',
  effectTags: ['drive', 'compressor'],
  description:
    'The fitted kick through Drive at its defaults (12 dB into the soft clip, 8 kHz tone) and Compressor at its defaults (−12 dB threshold, 4:1, 10 ms attack): the click passes before the compressor acts, and it then holds the body under its threshold. Four on the floor.',
  sequencer: euclid('x...x...x...x...'),
  inserts: [{ ...m.DEFAULT_DRIVE }, { ...m.DEFAULT_COMPRESSOR }],
  hand: [],
});

const dubHat = (m) => ({
  id: 'dub-hat',
  name: 'Dub Hat',
  patchSource: 'tr909-hat-closed',
  effectTags: ['filter', 'delay'],
  description:
    'The closed hat through Filter and Dub delay. The Filter is set by hand to a 24 dB highpass at 5 kHz with 1.5 resonance, a peak at the cutoff to ride with the knob; the Dub delay is its Roots dub starting point (ping-pong dotted quarters that darken as they repeat) at the kind’s 0.3 mix. Offbeat eighths with a pickup.',
  sequencer: euclid('..x...x...x...xx'),
  inserts: [
    { ...m.DEFAULT_FILTER, mode: 'highpass', slope24: true, cutoff: 5000, resonance: 1.5 },
    m.applyDelayPreset(m.DEFAULT_DELAY, 'dub'),
  ],
  hand: ['Filter mode highpass, 24 dB, cutoff 5 kHz, resonance 1.5'],
});

const roomClap = (m) => ({
  id: 'room-clap',
  name: 'Room Clap',
  patchSource: 'tr909-clap',
  effectTags: ['reverb'],
  description:
    'The fitted clap into Reverb’s Club Toilets starting point from the Drums group, a 0.6 s room, at the kind’s 0.3 mix. On beats two and four.',
  sequencer: euclid('....x.......x...'),
  inserts: [m.applyReverbPreset(m.DEFAULT_REVERB, 11)],
  hand: [],
});

const acidLine = (m) => ({
  id: 'acid-line',
  name: 'Acid Line',
  patchSource: 'acid-saw',
  effectTags: ['drive', 'delay'],
  description:
    'The ladder saw on a Basslead line that follows the chord root, with accents, slides and octave jumps, through Advanced Drive’s Biased acid starting point (a tube stage into a biased diode stage behind its own resonant filter) and Dub delay’s Tape echo starting point. The delay’s mix is set by hand to 0.2, under the kind’s 0.3, so the repeats sit under the dry line.',
  lowCut: undefined,
  sequencer: {
    kind: 'bass',
    pitchMode: 'followRoot',
    divisor: 6,
    gate: 0.8,
    register: { octave: 2 },
    density: 1,
    length: 16,
    steps: ['n', 'r', '+A', 'nS', 'n', '+S', 'nA', 'r', 'n', 'n', '+AS', '+', 'r', 'nA', '+S', 'n'].map(cell),
  },
  inserts: [
    m.applyAdvancedDrivePreset(m.DEFAULT_ADVANCED_DRIVE, 'acid'),
    { ...m.applyDelayPreset(m.DEFAULT_DELAY, 'tape'), mix: 0.2 },
  ],
  hand: ['Dub delay mix 0.2'],
});

const echoStab = (m) => ({
  id: 'echo-stab',
  name: 'Echo Stab',
  patchSource: 'str-edm-stab',
  effectTags: ['chorus', 'echo'],
  description:
    'The string stab on offbeat eighths through Chorus’s Slow starting point (a 0.51 Hz sweep, the two sides inverted) at the kind’s 0.5 mix and Echo at its defaults (dotted eighths, 0.3 feedback, 0.3 mix). The low cut is set by hand to 150 Hz, out of the kick and the bass.',
  lowCut: 150,
  sequencer: {
    kind: 'chord',
    divisor: 12,
    gate: 0.5,
    voicing: 'close',
    register: { octave: 4 },
    steps: [m.restStep(), m.hitStep()],
    follow: false,
  },
  inserts: [m.applyChorusPreset(m.DEFAULT_CHORUS, 'slow'), { ...m.DEFAULT_ECHO }],
  hand: ['low cut 150 Hz'],
});

const pumpingPad = (m) => ({
  id: 'pumping-pad',
  name: 'Pumping Pad',
  patchSource: 'pad-drift',
  effectTags: ['ensemble', 'reverb', 'pump'],
  description:
    'The drifting pad held over four bars, following the chords, through Ensemble’s Deep starting point, Reverb’s Euphoria starting point from the Pads & leads group (3.5 s) at the kind’s 0.3 mix, and Pump at its defaults, a quarter-note duck. Pump is keyed from outside: pick the kick as its key after loading. The low cut is raised by hand to 180 Hz, above the kick and the bass.',
  lowCut: 180,
  sequencer: {
    kind: 'chord',
    divisor: 96,
    gate: 1,
    voicing: 'close',
    register: { octave: 3 },
    steps: [m.hitStep({ duration: 4 })],
    follow: true,
  },
  inserts: [
    m.applyEnsemblePreset(m.DEFAULT_ENSEMBLE, 'deep'),
    m.applyReverbPreset(m.DEFAULT_REVERB, 18),
    { ...m.DEFAULT_PUMP, sidechain: { track: null } },
  ],
  hand: ['low cut 180 Hz'],
});

const phasedArp = (m) => ({
  id: 'phased-arp',
  name: 'Phased Arp',
  patchSource: 'lead-sync-sweep',
  effectTags: ['phaser', 'echo'],
  description:
    'The sync lead arpeggiating the chord upward over two octaves in sixteenths, an accent on the first note of each turn, through Phaser’s Deep color starting point at the kind’s 0.5 mix and Echo at its defaults (dotted eighths, 0.3 feedback, 0.3 mix). The low cut is set by hand to 150 Hz.',
  lowCut: 150,
  sequencer: {
    kind: 'arp',
    style: 'up',
    divisor: 6,
    gate: 0.5,
    octaves: 2,
    voicing: 'close',
    retrigger: false,
    register: { octave: 4 },
    // 32 cells, as the Arp keeps; one turn of up over a triad and two octaves reads the first six.
    steps: ['A', ...Array(31).fill('n')].map(cell),
  },
  inserts: [m.applyPhaserPreset(m.DEFAULT_PHASER, 'color'), { ...m.DEFAULT_ECHO }],
  hand: ['low cut 150 Hz'],
});

const tapeTom = (m) => ({
  id: 'tape-tom',
  name: 'Tape Tom',
  patchSource: 'tr909-tom-mid',
  effectTags: ['tape'],
  description:
    'The fitted mid tom on a syncopated figure, tuned by a pitch lane (up a fourth, down a tone, up a minor third), through Tape’s Metal punch starting point: the metal tape driven at 10 with a little wow and flutter.',
  sequencer: {
    ...euclid('x..x..x...x..x..'),
    pitchLane: [0, 0, 0, 5, 0, 0, -2, 0, 0, 0, 3, 0, 0, 0, 0, 0],
  },
  inserts: [m.applyTapePreset(m.DEFAULT_TAPE, 'metal')],
  hand: [],
});

/** The recipes, in the order the listen renders them. */
export const recipes = (m) => [
  drivenKick(m),
  dubHat(m),
  roomClap(m),
  acidLine(m),
  echoStab(m),
  pumpingPad(m),
  phasedArp(m),
  tapeTom(m),
];
