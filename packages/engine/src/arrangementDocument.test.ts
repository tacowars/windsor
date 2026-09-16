/**
 * `makeArrangement` (issue #75, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §4–§5): never
 * throws, clamps and defaults with corrections reported, drops what cannot
 * play, round-trips, and yields the metronome fallback when nothing usable
 * survives. Since #597 a document is `version: 2` with a slot-keyed part list.
 */
import { describe, expect, it } from 'vitest';

import type { Arrangement } from './arrangement';
import type { ArrangementDocument } from './arrangementDocument';
import { isShippable, makeArrangement } from './arrangementDocument';
import { ArrangementPlayer, type PlayablePart } from './arrangementPlayer';
import type { PresetTable } from './arrangementValidate';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { DEFAULT_STRIP } from './mix';
import { PRESETS } from './presets';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from './scheduler';

const silentPart = (): PlayablePart => ({
  noteOn: () => 0,
  noteOffByNote: () => {},
  trigger: () => 0,
  setPatch: () => {},
  allNotesOff: () => {},
});

/** The document's own patches — the only table the game resolves against (#562). */
const patchesOf = (arrangement: Arrangement): PresetTable =>
  (arrangement as ArrangementDocument).patches ?? {};

/** Building and running the player is the "usable" proof: no constructor throws. */
function play(arrangement: Arrangement): void {
  const parts = new Map(arrangement.parts.map((p) => [p.slot, silentPart()]));
  const transport = new TickTransport();
  const player = new ArrangementPlayer(transport, parts, arrangement, patchesOf(arrangement));
  for (let i = 0; i < TICKS_PER_BAR; i++) transport.advance(0);
  player.dispose();
}

/**
 * The library ids these normalisation cases name, embedded as `{}` — which
 * `patchNormalise` completes from `makePatch()` without a correction. Since
 * #562 a document resolves only its own `patches`, so a case about clamping
 * or defaults has to carry the patches its parts play.
 */
const PATCHES = { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} };

/** A version-2 document carrying `PATCHES` and the given parts. */
const song = (parts: unknown[], rest: Record<string, unknown> = {}): Record<string, unknown> => ({
  version: 2,
  patches: PATCHES,
  parts,
  ...rest,
});

const KICK = { slot: 0, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean' } };

const JUNK: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 42],
  ['a string', 'arrangement'],
  ['an array', [1, 2, 3]],
  ['an empty object', {}],
  ['a version-2 shell with nothing in it', { version: 2 }],
  ['wrong types throughout', { version: 2, seed: 'x', bpm: 'fast', key: 3, parts: [{ preset: 9 }] }],
  ['a truncated document', song([{ slot: 0, preset: 'kick' }, { preset: 'hat' }])],
  [
    'out-of-range numbers',
    song([
      {
        slot: 0,
        preset: 'kick',
        velocity: 9,
        sequencer: {
          kind: 'euclidean',
          note: -5,
          hold: -1,
          steps: 0,
          divisor: 7,
          pulses: { min: 9, max: 2, start: 99 },
        },
      },
    ], { bpm: 1e9 }),
  ],
  ['a prototype-chain preset name', song([{ slot: 0, preset: 'toString' }])],
  [
    'unknown keys everywhere',
    song([{ ...KICK, wobble: 2, sequencer: { kind: 'euclidean', flux: 3 } }], { wat: 1 }),
  ],
  ['a junk sequencer kind', song([{ ...KICK, sequencer: { kind: 'theremin', gate: 1 } }])],
];

describe('makeArrangement never throws', () => {
  it.each(JUNK)('yields a playable arrangement from %s', (_name, raw) => {
    const result = makeArrangement(raw);
    expect(() => play(result.document)).not.toThrow();
  });
});

describe('corrections are reported', () => {
  it('names every clamp by path', () => {
    const result = makeArrangement(song([{ ...KICK, velocity: 9 }], { bpm: 9999 }));
    expect(result.usable).toBe(true);
    expect(result.corrections).toContain('parts[0].velocity: clamped 9 to 1');
    expect(result.corrections).toContain('bpm: clamped 9999 to 300');
  });

  it('names every dropped unknown key by path', () => {
    const result = makeArrangement(song([{ ...KICK, wobble: 2 }], { wat: 1 }));
    expect(result.corrections).toContain('wat: unknown key dropped');
    expect(result.corrections).toContain('parts[0].wobble: unknown key dropped');
  });

  it('drops a field another kind owns, by path', () => {
    const result = makeArrangement(song([{ ...KICK, sequencer: { kind: 'arp', note: 40 } }]));
    expect(result.corrections).toContain('parts[0].sequencer.note: unknown key dropped');
  });

  it('replaces a divisor that does not divide the bar', () => {
    const result = makeArrangement(
      song([{ slot: 3, preset: 'drone-sqr', sequencer: { kind: 'step', divisor: 7 } }]),
    );
    expect(result.corrections.join('\n')).toMatch(/divisor: 7 does not divide the 96-tick bar/);
    const sequencer = result.document.parts[0]?.sequencer;
    expect(sequencer?.kind === 'step' && sequencer.divisor).toBe(96);
  });

  it('takes defaults for absent optional fields silently', () => {
    const result = makeArrangement(song([{ slot: 4, preset: 'kick', sequencer: { kind: 'euclidean' } }]));
    expect(result.usable).toBe(true);
    expect(result.corrections).toEqual([]);
    const [part] = result.document.parts;
    expect(part?.name).toBe('Part 5');
    expect(part?.strip).toEqual(DEFAULT_STRIP);
    expect(part?.sequencer.kind === 'euclidean' && part.sequencer.steps).toBe(16);
  });

  it('reads an absent sequencer as none, silently, and an unknown kind as none, reported', () => {
    const absent = makeArrangement(song([{ slot: 0, preset: 'kick' }]));
    expect(absent.corrections).toEqual([]);
    expect(absent.document.parts[0]?.sequencer).toEqual({ kind: 'none' });
    const junk = makeArrangement(song([{ slot: 0, preset: 'kick', sequencer: { kind: 'theremin' } }]));
    expect(junk.document.parts[0]?.sequencer).toEqual({ kind: 'none' });
    expect(junk.corrections.join('\n')).toMatch(/parts\[0\]\.sequencer\.kind/);
  });
});

describe('the part list (#597)', () => {
  it('normalises any kind on any slot: four arpeggiators', () => {
    const arps = [0, 1, 2, 3].map((slot) => ({
      slot,
      name: `arp ${slot}`,
      preset: 'saw-arp',
      sequencer: { kind: 'arp' },
    }));
    const result = makeArrangement(song(arps));
    expect(result.corrections).toEqual([]);
    expect(result.document.parts.map((p) => [p.slot, p.sequencer.kind])).toEqual([
      [0, 'arp'],
      [1, 'arp'],
      [2, 'arp'],
      [3, 'arp'],
    ]);
    expect(isShippable(result)).toBe(true);
  });

  it('normalises three Euclidean parts and one step part, in list order', () => {
    const result = makeArrangement(
      song([
        { slot: 5, preset: 'kick', sequencer: { kind: 'euclidean', note: 36 } },
        { slot: 2, preset: 'hat', sequencer: { kind: 'euclidean', note: 42 } },
        { slot: 7, preset: 'hat', sequencer: { kind: 'euclidean', note: 46 } },
        { slot: 0, preset: 'drone-sqr', sequencer: { kind: 'step' } },
      ]),
    );
    expect(result.corrections).toEqual([]);
    expect(result.document.parts.map((p) => p.slot)).toEqual([5, 2, 7, 0]);
    expect(() => play(result.document)).not.toThrow();
  });

  it('drops a later part on a slot already used, reported', () => {
    const result = makeArrangement(
      song([KICK, { slot: 0, name: 'hat', preset: 'hat', sequencer: { kind: 'euclidean' } }]),
    );
    expect(result.document.parts.map((p) => p.name)).toEqual(['kick']);
    expect(result.corrections).toContain('parts[1]: slot 0 is already used — part dropped');
  });

  it('drops a part with no slot or one out of range: identity has no default', () => {
    const result = makeArrangement(
      song([
        KICK,
        { preset: 'hat' },
        { slot: 8, preset: 'hat' },
        { slot: 1.5, preset: 'hat' },
      ]),
    );
    expect(result.document.parts.map((p) => p.slot)).toEqual([0]);
    expect(result.corrections).toEqual([
      'parts[1].slot: undefined is not a slot 0–7 — part dropped',
      'parts[2].slot: 8 is not a slot 0–7 — part dropped',
      'parts[3].slot: 1.5 is not a slot 0–7 — part dropped',
    ]);
  });

  it('keeps at most eight parts', () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ slot: i % 8, preset: 'kick' }));
    const result = makeArrangement(song(nine));
    expect(result.document.parts).toHaveLength(8);
    expect(result.corrections[0]).toBe('parts: 9 parts — only the first 8 are kept');
  });

  it('corrects a name that is not a string to "Part n"', () => {
    const result = makeArrangement(song([{ ...KICK, slot: 2, name: 7 }]));
    expect(result.document.parts[0]?.name).toBe('Part 3');
    expect(result.corrections).toEqual(['parts[0].name: 7 is not a name — using "Part 3"']);
  });

  it('normalises a part strip over DEFAULT_STRIP', () => {
    const result = makeArrangement(
      song([{ ...KICK, strip: { level: 9, pan: -0.5, sends: { room: 0.4 } } }]),
    );
    expect(result.document.parts[0]?.strip).toEqual({ level: 4, pan: -0.5, sends: { room: 0.4 } });
    expect(result.corrections).toEqual(['parts[0].strip.level: clamped 9 to 4']);
  });

  it('is unusable when the version is not 2', () => {
    for (const version of [undefined, 1, '2', 3]) {
      const result = makeArrangement({ ...song([KICK]), version });
      expect(result.usable, String(version)).toBe(false);
      expect(result.corrections[0]).toMatch(/^version: /);
    }
  });

  it('is usable with only none parts, and not shippable', () => {
    const result = makeArrangement(song([{ slot: 0, preset: 'kick', sequencer: { kind: 'none' } }]));
    expect(result.usable).toBe(true);
    expect(isShippable(result)).toBe(false);
    expect(() => play(result.document)).not.toThrow();
  });
});

describe('the fallback (record §4)', () => {
  it('is what nothing usable normalises to', () => {
    const result = makeArrangement(null);
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(isShippable(result)).toBe(false);
    expect(result.corrections.at(-1)).toMatch(/falling back to the metronome/);
  });

  it('is one non-generative part on a quarter-note pulse, no sends, no pitched parts', () => {
    const f = FALLBACK_ARRANGEMENT;
    expect(f.parts).toHaveLength(1);
    const [click] = f.parts;
    const sequencer = click.sequencer;
    expect(sequencer.divisor).toBe(DIVISORS.quarter);
    // min === max: the density LFO has nothing to modulate — not generative.
    expect(sequencer.pulses.min).toBe(sequencer.pulses.max);
    // pulses === steps: E(n, n) fires on every step — a plain pulse.
    expect(sequencer.pulses.min).toBe(sequencer.steps);
    // No sends: unity, centred, sends nothing — whatever a song's strips say.
    expect(click.strip).toBe(DEFAULT_STRIP);
    expect(DEFAULT_STRIP.sends).toEqual({});
  });

  it('clicks exactly once per quarter note, unvarying', () => {
    const transport = new TickTransport(FALLBACK_ARRANGEMENT.bpm);
    let triggers = 0;
    const clicker = { ...silentPart(), trigger: () => ++triggers };
    const player = new ArrangementPlayer(
      transport,
      new Map([[0, clicker]]),
      FALLBACK_ARRANGEMENT,
      FALLBACK_ARRANGEMENT.patches,
    );
    for (let i = 0; i < 4 * TICKS_PER_BAR; i++) transport.advance(0);
    expect(triggers).toBe(16);
    player.dispose();
  });
});

describe('round-trip: normalise → serialise → normalise', () => {
  it('is equal and correction-free on the normalised object', () => {
    const messy = song(
      [
        { ...KICK, velocity: 3, strip: { level: 9 }, sequencer: { kind: 'euclidean', divisor: 5 } },
        { slot: 2, preset: 'saw-arp', sequencer: { kind: 'arp', gate: 2, walk: 'sideways' } },
        { slot: 1, preset: 'hat', strip: { sends: { echo: 2 } } },
      ],
      { seed: 204.4, bpm: 500, key: { root: 50, scale: 'dorian', weights: [4, 1] } },
    );
    const first = makeArrangement(messy);
    expect(first.usable).toBe(true);
    expect(first.corrections.length).toBeGreaterThan(0);
    const second = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(second.document).toEqual(first.document);
    expect(second.corrections).toEqual([]);
    expect(second.dangling).toEqual([]);
  });

  it('holds on the fallback itself', () => {
    const again = makeArrangement(JSON.parse(JSON.stringify(FALLBACK_ARRANGEMENT)));
    expect(again.usable).toBe(true);
    expect(again.corrections).toEqual([]);
    expect(again.dangling).toEqual([]);
    expect(again.document).toEqual(FALLBACK_ARRANGEMENT);
  });
});

describe('runtime inputs JSON cannot represent (self-review findings)', () => {
  it('never throws on BigInt or cyclic values in a field', () => {
    const bigint = makeArrangement(song([{ ...KICK, velocity: 1n }]));
    expect(bigint.document.parts[0]?.velocity).toBe(0.8);
    expect(bigint.corrections.join('\n')).toMatch(/parts\[0\]\.velocity/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => makeArrangement(song([{ ...KICK, velocity: cyclic }]))).not.toThrow();
    expect(() => makeArrangement(song([{ ...KICK, slot: cyclic }]))).not.toThrow();
    expect(() => makeArrangement(1n)).not.toThrow();
  });
});

describe('a song resolves only its own patches (#562)', () => {
  const UNEMBEDDED = {
    version: 2,
    seed: 204,
    bpm: 96,
    key: { root: 50, scale: 'dorian', weights: [4, 1, 2, 2, 3, 1, 2] },
    parts: [
      { slot: 0, name: 'kick', preset: 'kick', sequencer: { kind: 'euclidean' } },
      { slot: 3, name: 'drone', preset: 'drone-sqr', sequencer: { kind: 'step' } },
    ],
  };

  it('drops a part naming a library id the document does not embed, and reports it', () => {
    const result = makeArrangement(UNEMBEDDED);
    // The ids are real library patches — that is exactly what no longer helps.
    expect(PRESETS.kick).toBeDefined();
    expect(PRESETS['drone-sqr']).toBeDefined();
    // Both parts drop, so nothing usable survives and the metronome plays.
    expect(result.usable).toBe(false);
    expect(result.document).toEqual(FALLBACK_ARRANGEMENT);
    expect(result.dangling).toEqual([
      'parts[0].preset: no preset "kick" is defined',
      'parts[1].preset: no preset "drone-sqr" is defined',
    ]);
    expect(result.filled).toEqual([]);
  });

  it('opens with a library fill: resolved once, embedded, and listed', () => {
    const result = makeArrangement(UNEMBEDDED, { libraryFill: PRESETS });
    expect(result.usable).toBe(true);
    expect(result.dangling).toEqual([]);
    expect(result.filled).toEqual(['kick', 'drone-sqr']);
    expect(result.document.patches?.kick).toEqual(PRESETS.kick);
    expect(result.document.patches?.['drone-sqr']).toEqual(PRESETS['drone-sqr']);
    // Embedded, not aliased: editing the document cannot reach the library.
    expect(result.document.patches?.kick).not.toBe(PRESETS.kick);
    // Only what the parts actually name is embedded, never the whole bank.
    expect(Object.keys(result.document.patches ?? {}).sort()).toEqual(['drone-sqr', 'kick']);
  });

  it('is self-contained after the fill: the same document needs no fill again', () => {
    const opened = makeArrangement(UNEMBEDDED, { libraryFill: PRESETS });
    const exported = JSON.parse(JSON.stringify(opened.document)) as unknown;
    const reopened = makeArrangement(exported);
    expect(reopened.filled).toEqual([]);
    expect(reopened.corrections).toEqual([]);
    expect(reopened.dangling).toEqual([]);
    expect(reopened.document).toEqual(opened.document);
  });

  it('embeds a forked patch and a library fill side by side', () => {
    // Derived from the library rather than pinned: re-tuning `kick` to any
    // level keeps this fork different from it.
    expect(PRESETS.kick?.volume).toBeGreaterThan(0);
    const forked = PRESETS.kick!.volume / 2;
    const result = makeArrangement(
      { ...UNEMBEDDED, patches: { kick: { volume: forked } } },
      { libraryFill: PRESETS },
    );
    expect(result.filled).toEqual(['drone-sqr']);
    // The document's own entry wins and is not refilled from the library.
    expect(result.document.patches?.kick?.volume).toBe(forked);
    expect(forked).not.toBe(PRESETS.kick?.volume);
  });

  it('leaves a name neither the document nor the library defines dangling', () => {
    const result = makeArrangement(
      { ...UNEMBEDDED, parts: [{ ...UNEMBEDDED.parts[0], preset: 'nope' }, UNEMBEDDED.parts[1]] },
      { libraryFill: PRESETS },
    );
    expect(result.dangling).toEqual(['parts[0].preset: no preset "nope" is defined']);
    expect(result.filled).toEqual(['drone-sqr']);
  });
});

describe("a document patch's mono field (#453)", () => {
  // `patchNormalise` walks the `makePatch` template and already handles
  // booleans, so the field needs no normaliser code -- which is exactly why it
  // is worth pinning: nothing else would fail if the walk stopped covering it.
  const withPatch = (patch: unknown): ReturnType<typeof makeArrangement> =>
    makeArrangement({ version: 2, parts: [KICK], patches: { kick: patch } });

  it('keeps true and false as given', () => {
    expect(withPatch({ mono: true }).document.patches?.kick?.mono).toBe(true);
    expect(withPatch({ mono: false }).document.patches?.kick?.mono).toBe(false);
    expect(withPatch({ mono: true }).corrections).toEqual([]);
  });

  it('corrects a non-boolean to the default, and reads an absent field as poly', () => {
    const junk = withPatch({ mono: 'yes' });
    expect(junk.document.patches?.kick?.mono).toBe(false);
    expect(junk.corrections).toEqual(['patches.kick.mono: "yes" is not a boolean — using false']);
    // Every document written before mono existed is this case.
    expect(withPatch({}).document.patches?.kick?.mono).toBe(false);
  });
});
