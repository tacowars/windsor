/**
 * `makeArrangement` (issue #75, record
 * `2026-08-31-arrangement-console-and-runtime-arrangements` §4–§5): never
 * throws, clamps and defaults with corrections reported, drops what cannot
 * play, round-trips, and yields the metronome fallback when nothing usable
 * survives. Since #597 a document carries a slot-keyed part list; since #705
 * it is `version: 3` — `transport`, `harmony`, per-part `regions` and a
 * per-sequencer `seed` — and a version-2 document is refused.
 */
import { describe, expect, it } from 'vitest';

import { isShippable, makeArrangement } from './arrangementDocument';
import { FALLBACK_ARRANGEMENT } from './fallbackArrangement';
import { DEFAULT_STRIP } from '../mixer/mix';
import { PRESETS } from '../patch/presets';
import { DEFAULT_GRID_CONFIG } from '../sequencing/gridSequencer';
import { ARRANGEMENT_VERSION, DEFAULT_BARS } from '../audioConstants';
import { DIVISORS, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { ArrangementPlayer } from './arrangementPlayer';
import { ALL, KICK, PATCHES, play, silentPart, song } from '../__fixtures__/documentCases';

const JUNK: Array<[string, unknown]> = [
  ['null', null],
  ['a number', 42],
  ['a string', 'arrangement'],
  ['an array', [1, 2, 3]],
  ['an empty object', {}],
  ['a version-2 document', { version: 2, seed: 1, bpm: 96, parts: [KICK], patches: PATCHES }],
  ['a current-version shell with nothing in it', { version: ARRANGEMENT_VERSION }],
  [
    'wrong types throughout',
    {
      version: ARRANGEMENT_VERSION,
      transport: 'fast',
      harmony: 3,
      parts: [{ preset: 9, regions: 'all' }],
    },
  ],
  ['a truncated document', song([{ slot: 0, preset: 'kick' }, { preset: 'hat' }])],
  [
    'out-of-range numbers',
    song(
      [
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
      ],
      { transport: { bpm: 1e9, bars: -2 } },
    ),
  ],
  [
    'overlapping regions and a junk harmony',
    song(
      [
        {
          ...KICK,
          regions: [
            { start: 96, duration: 1e6 },
            { start: 0, duration: 200 },
          ],
        },
      ],
      { harmony: { root: 40, scale: 'nope', events: [{ start: -3, degree: 'ii' }] } },
    ),
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
    const result = makeArrangement(song([{ ...KICK, velocity: 9 }], { transport: { bpm: 9999 } }));
    expect(result.usable).toBe(true);
    expect(result.corrections).toContain('parts[0].velocity: clamped 9 to 1');
    expect(result.corrections).toContain('transport.bpm: clamped 9999 to 300');
  });

  it('names every dropped unknown key by path', () => {
    const result = makeArrangement(song([{ ...KICK, wobble: 2 }], { wat: 1 }));
    expect(result.corrections).toContain('wat: unknown key dropped');
    expect(result.corrections).toContain('parts[0].wobble: unknown key dropped');
  });

  it('drops a field another kind owns, by path', () => {
    const result = makeArrangement(song([{ ...KICK, sequencer: { kind: 'grid', note: 40 } }]));
    expect(result.corrections).toContain('parts[0].sequencer.note: unknown key dropped');
  });

  it('replaces a divisor that does not divide the bar', () => {
    const result = makeArrangement(
      song([{ slot: 3, preset: 'drone-sqr', sequencer: { kind: 'grid', divisor: 7 } }]),
    );
    expect(result.corrections.join('\n')).toMatch(/divisor: 7 does not divide the 96-tick bar/);
    const sequencer = result.document.parts[0]?.sequencer;
    expect(sequencer?.kind === 'grid' && sequencer.divisor).toBe(DEFAULT_GRID_CONFIG.divisor);
  });

  it('takes defaults for absent optional fields silently', () => {
    const result = makeArrangement(
      song([{ slot: 4, preset: 'kick', sequencer: { kind: 'euclidean', seed: 0 } }]),
    );
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
    const junk = makeArrangement(
      song([{ slot: 0, preset: 'kick', sequencer: { kind: 'theremin' } }]),
    );
    expect(junk.document.parts[0]?.sequencer).toEqual({ kind: 'none' });
    expect(junk.corrections.join('\n')).toMatch(/parts\[0\]\.sequencer\.kind/);
  });

  it('reads a deleted step part as none, reported (#704; #705 brought `arp` back as its own kind)', () => {
    const result = makeArrangement(
      song([{ slot: 2, preset: 'saw-arp', sequencer: { kind: 'step' } }]),
    );
    expect(result.document.parts[0]?.sequencer).toEqual({ kind: 'none' });
    expect(result.corrections.join('\n')).toMatch(/parts\[0\]\.sequencer\.kind/);
  });

  it('reports harmony.weights as an unknown key and changes nothing else (#704, #705)', () => {
    const harmony = { root: 2, scale: 'dorian' };
    const plain = makeArrangement(song([KICK], { harmony }));
    const weighted = makeArrangement(
      song([KICK], { harmony: { ...harmony, weights: [4, 1, 2, 2, 3, 1, 2] } }),
    );
    expect(weighted.corrections).toEqual([
      ...plain.corrections,
      'harmony.weights: unknown key dropped',
    ]);
    expect(weighted.document).toEqual(plain.document);
    expect(weighted.document.harmony).toMatchObject(harmony);
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
    const transport = new TickTransport(FALLBACK_ARRANGEMENT.transport.bpm);
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
        {
          ...KICK,
          velocity: 3,
          strip: { level: 9 },
          sequencer: { kind: 'euclidean', divisor: 5, seed: 204.4 },
        },
        { slot: 2, preset: 'saw-arp', sequencer: { kind: 'grid', skipChance: 2, length: 99 } },
        { slot: 1, preset: 'hat', strip: { sends: { echo: 2 } }, regions: [{ start: 400 }] },
      ],
      {
        transport: { bpm: 500, bars: 4.5 },
        harmony: { root: 14, scale: 'dorian', events: [{ start: 200, degree: 3, duration: 5 }] },
      },
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
    version: ARRANGEMENT_VERSION,
    transport: { bpm: 96, bars: DEFAULT_BARS },
    harmony: { root: 2, scale: 'dorian' },
    parts: [
      {
        slot: 0,
        name: 'kick',
        preset: 'kick',
        regions: ALL,
        sequencer: { kind: 'euclidean', seed: 204 },
      },
      { slot: 3, name: 'drone', preset: 'drone-sqr', regions: ALL, sequencer: { kind: 'chord' } },
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
    makeArrangement({ version: ARRANGEMENT_VERSION, parts: [KICK], patches: { kick: patch } });

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
