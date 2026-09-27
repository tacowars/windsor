# Scoring preset library

Issue #475 adds 100 starting points for moody atmospheres and minimal dub
techno: 16 strings, 24 pads, 20 plucks, 16 basses and 24 soundtrack FX.
The original 14 IDs remain valid. Four gameplay sounds are available under
**Legacy game FX**, outside the default **All musical sounds** view.

Open `tools/patch-editor/patch-editor.html`, enable audio, select a part and
use the Parts rail's search, category, tag and source filters. Search words
match across names, IDs, tags and playing notes; all words must match.
Filters intersect. Arrow keys browse the native result list; **Enter**,
**Load patch** or a double click loads the highlighted sound. Filtering and
highlighting do not change the current sound. Play with the on-screen keys
or move focus out of the search/list before using QWERTY notes.

Loading copies the complete patch into the song immediately, including
additive harmonics. Existing document patches take precedence over factory
patches. Rename and revert keep their existing behavior; reverting deliberately
returns to the factory reference. Unknown custom patch IDs appear as
Uncategorized and remain searchable by name. Editing custom tags is outside
this first browser: the catalog describes factory starting points.

## Sound design and limits

These are synthetic scoring voices, not acoustic-instrument emulations.
Strings use detuned saw or harmonic carriers in two FM stacks; pads add
three small authored harmonic spectra, each with a unique wavetable-cache
key. Dub plucks combine two decaying stacks with a closing lowpass; mallets
use brighter integer or inharmonic modulation ratios. Basses use mono
retrigger, centered pan and no spread. Soundtrack FX use filtered noise,
inharmonic FM, sample-and-hold changes and amplitude pulses.

The instrument squares operator levels before applying the amplitude
envelope. A small level change can therefore make a significant change in
modulation depth. Spread doubles the voices used by a note; slow release
tails and dense chords need room in the part's voice budget.

**Fixed frequency is per operator.** With Fixed off, note pitch, pitch
envelope, bend, glide and pitch LFO contribute to that operator's frequency.
With Fixed on, this engine uses `fixedHz` plus operator detune and bypasses
those pitch controls. The existing kick uses note-tracking operators, so its
pitch envelope is active. A fixed-frequency modulator can coexist with a
sweeping carrier. Noise is shaped primarily with amplitude/filter envelopes.
The new noise risers/downlifters sweep their filters; none promises a
pitched sweep of a fixed-frequency oscillator.

LFO rates and envelope times are in Hz and seconds, not beat-synchronized.
The sequencer controls note gates: release a six-second riser early and its
attack is interrupted. Hold the note for the described duration to hear the
whole gesture. Pulsers are free-running amplitude modulation, not generators
of note events. “Uneasy Scale” describes spatial scale, not a musical scale.

Delay and plate settings belong to the song's mixer, not the patch. Playing
notes below suggest sends, but selecting a sound does not change the mixer.
For dub chords, begin with short gates and the existing damped dotted-eighth
delay. For atmosphere, hold sparse voicings and raise the room send gradually.
Bass patches are intended to start dry. Patch headroom cannot guarantee that
an arbitrary arrangement, mixer gain or feedback setting will not overload.

## Bank

### Strings

| Preset | Tags | Playing notes |
|---|---|---|
| Drowned Cellos | dark, bowed, low | Play C2–C4; hold 3–6 seconds. Keep room send subtle. |
| Estuary Violas | warm, bowed, ensemble | Play C3–C5 in open fifths; a little plate blends the attacks. |
| Salt Violins | airy, bowed, ensemble | Play C4–C6; use soft velocity for distant upper lines. |
| Muted Chamber | muted, intimate, soft | Play C3–C5; close triads and short releases suit sparse scoring. |
| Frozen Bow | cold, bowed, tension | Play C3–C5; hold slowly for the glassy beating to emerge. |
| Rust Ensemble | rough, bowed, tension | Play C2–C4; single notes or fifths keep the inharmonic edge clear. |
| Low Tremolo | dark, restless, low | Play C2–C3; quick drift in FM brightness gives restless bow texture. |
| High Tremolo | bright, restless, high | Play C4–C5; repeat short notes under a quieter sustained voice. |
| Hollow Bows | hollow, bowed, soft | Play C3–C4; bandpassed body leaves room for a separate bass. |
| Violet Section | lush, warm, ensemble | Play C3–C5; leave space between chord changes for the release. |
| Wire Harmonics | harmonics, thin, cold | Play C4–C6; isolated notes or octave doubles with plate. |
| Silt Contrabass | dark, low, bowed | Play C2–C3; slow roots under upper-register atmosphere. |
| Breathing Rosin | rough, evolving, bowed | Hold C3–C4 for 5 seconds or longer; sparse voicings. |
| Afterimage Quartet | soft, intimate, warm | Play C3–C5; restrained three-note chords and modest room send. |
| Black Ice Strings | cold, tension, slow | Hold C3–C5 for 6–8 seconds; the slow FM bloom is the gesture. |
| Remote Orchestra | distant, slow, ensemble | Play C3–C5; long open chords with a generous plate send. |

### Pads

| Preset | Tags | Playing notes |
|---|---|---|
| Harbour Fog | dark, warm, slow | Hold C3–C5 for 6 seconds; low-velocity open chords. |
| Deep Current | dark, low, drone | Play C2–C4; use one or two notes below the melody. |
| Empty Station | hollow, distant, cinematic | Play C3–C5; plate lengthens the empty-room impression. |
| Blue Vapour | cold, airy, slow | Play C4–C5; soft dyads over a dark bass. |
| Tape Halo | warm, unstable, dub | Play C3–C5; add a damped dotted-eighth delay on the mixer. |
| Night Choir | vocal, dark, slow | Hold C3–C4 for 6 seconds; fifths leave the vocal colour uncluttered. |
| Glass Horizon | cold, glass, airy | Play C4–C6; use a restrained plate send for upper light. |
| Underwater Room | dark, dub, submerged | Play C3–C4; slightly stagger chord notes into damped delay. |
| Ash Cathedral | vocal, tension, vast | Play C3–C5; hold sparse intervals for 8 seconds. |
| Soft Machinery | mechanical, warm, evolving | Play C3–C5; shorter chords expose the changing FM edge. |
| Polar Bloom | cold, evolving, slow | Hold C3–C5 for 8 seconds to hear the delayed brightness. |
| Amber Ceiling | warm, open, soft | Play C3–C5; a gentle, relatively open harmonic bed. |
| Ghost Formants | vocal, hollow, eerie | Play C3–C5; single-note melodies or widely spaced chords. |
| Low Weather | rough, low, tension | Play C2–C3; sustained fundamentals with an unsettled edge. |
| Faded Neon | glass, dub, luminous | Play C4–C5; clipped chords into the mixer delay. |
| Quiet Reactor | dark, mechanical, evolving | Play C3–C4; hold against a sparse ticking layer. |
| Long Dusk | warm, slow, distant | Hold C3–C5 for 8–10 seconds; allow the full release. |
| Silver Dust | airy, high, glass | Play C4–C6; quiet notes above a darker sustained pad. |
| Buried Voices | vocal, dark, low | Play C2–C4; use sparse intervals and low mixer level. |
| Magnetic Veil | warm, restless, ensemble | Play C3–C5; evolving detuned body without a long swell. |
| Tidal Memory | dub, dark, evolving | Play C3–C4; let one chord fade before introducing the next. |
| Pale Monolith | cold, atonal, vast | Hold one C3–C4 note for 10 seconds; inharmonic upper haze. |
| Velvet Airlock | soft, hollow, intimate | Play C3–C5; short gentle chord answers between bass notes. |
| Open Sea | airy, open, vast | Play C3–C5; sustained open fifths with room send to taste. |

### Plucks

| Preset | Tags | Playing notes |
|---|---|---|
| Concrete Chord | dub, muted, chord | Play short C3–C5 minor chords; add damped dotted-eighth delay. |
| Moss Stab | dub, dark, chord | Play C3–C4 offbeat chords; keep the bass on another part. |
| Porcelain Drop | bell, glass, sparse | Play C4–C6 single notes; plate and sparse delay repeats. |
| Wooden Pin | wood, muted, short | Play C3–C5 in a sparse sixteenth pattern. |
| Rubber Key | dub, rubber, short | Play C2–C4; short notes with a warm low-mid bounce. |
| Tin Kalimba | metal, plucked, sparse | Play C4–C5; leave rests for the inharmonic tail. |
| Felt Circuit | soft, muted, intimate | Play C3–C5 softly; a restrained melodic starting point. |
| Amber Stab | dub, warm, chord | Play C3–C5 triads; shorter gates make room for delay. |
| Ice Needle | glass, high, short | Play C5–C6 single notes at low mix level. |
| Rusted Tine | metal, rough, tension | Play C3–C5; isolated notes make useful uneasy punctuation. |
| Submerged Keys | dub, dark, soft | Play C3–C4; long damped delay brings the quiet attack forward. |
| Wire Harp | harmonics, plucked, long | Play C3–C5 broken chords; leave room for overlapping tails. |
| Shortwave Chord | dub, bright, restless | Play C3–C5 syncopated stabs with short mixer delay. |
| Stone Marimba | wood, low, muted | Play C2–C4 as sparse melodic percussion. |
| Hollow Droplet | hollow, bell, soft | Play C4–C5; single notes over a sustained drone. |
| Velvet Offbeat | dub, soft, chord | Play C3–C4 chords; slower attack softens the offbeat. |
| Glass Pebble | glass, short, high | Play C4–C6; sparse little accents, not a continuous hat line. |
| Bronze Rain | metal, long, tension | Play C3–C5; use few notes to preserve tail headroom. |
| Dry Relay | dub, short, mechanical | Play C3–C5 tight rhythmic chords; delay supplies the sustain. |
| Last Light Bell | bell, soft, long | Play C4–C5; long melodic tails into a subtle plate. |

### Basses

| Preset | Tags | Playing notes |
|---|---|---|
| Round Foundation | sub, warm, mono | Play C1–C3; keep delay and plate sends near zero. |
| Dockside Bass | dub, warm, mono | Play C1–C3 syncopated notes; moderate velocity. |
| Hollow Anchor | hollow, sub, mono | Play C1–C3; leave space between notes for the rounded tail. |
| Carbon Reed | reedy, dark, mono | Play C2–C3 short ostinatos below sustained pads. |
| Soft Undertow | sub, soft, long | Play C1–C2; longer held roots and very little return send. |
| Iron Root | rough, dub, mono | Play C1–C3; dry bass stabs with a little filter movement. |
| Sine Weight | sub, pure, soft | Play C1–C3; a near-sine anchor for busier upper voices. |
| Muted Cable | muted, dark, mono | Play C2–C3; warm restrained bass notes under dub chords. |
| Night Rubber | rubber, dub, short | Play C1–C3; tight rhythmic notes with a soft FM knock. |
| Low Transformer | mechanical, reedy, mono | Play C2–C3; hold a note to hear the FM brightness move. |
| Silt Pulse Bass | sub, short, muted | Play C1–C3 repeated short notes; sequence the pulse externally. |
| Warm Pressure | warm, soft, long | Play C1–C3; sustained roots with gentle attacks. |
| Graphite Bass | digital, hollow, mono | Play C2–C3; inharmonic transient over a firm fundamental. |
| Tunnel Growl | rough, tension, mono | Play C1–C3; restrained mixer level beside a quiet drone. |
| Felt Sub | sub, soft, muted | Play C1–C2; gentle short bass notes in minimal arrangements. |
| Copper Step | reedy, short, dub | Play C2–C3 sparse syncopated steps; dry or minimal room. |

### Soundtrack FX

| Preset | Tags | Playing notes |
|---|---|---|
| Vent Breath | noise, whoosh, dark | Hold 3–5 seconds; the filter shapes the noise, keyboard pitch is secondary. |
| Silk Swish | noise, swish, airy | Tap and release after half a second for a short transition. |
| Slow Air Riser | noise, riser, slow | Hold 6–8 seconds: the filter opens four octaves; release at the transition. |
| Narrow Riser | noise, riser, tense | Hold at least 3 seconds; a narrower, brighter build. |
| Long Downwash | noise, downlifter, dark | Hold 5 seconds so the descending filter completes before release. |
| Quick Downwash | noise, downlifter, short | Hold about 1.5 seconds; short filtered-noise transition. |
| Radio Dust | noise, static, thin | Hold for a static bed; bandpass removes most low-frequency weight. |
| Deep Static | noise, static, dark | Hold 2–4 seconds beneath a sparse tonal layer. |
| Dry Ticker | ticker, rhythmic, metallic | Hold C3–C5; amplitude pulses at 6 Hz, not tempo-synced. |
| Hollow Ticker | ticker, hollow, rhythmic | Hold C3–C4; 3 Hz pulse, or retrigger notes with the sequencer. |
| Slow Beacon | pulser, slow, tension | Hold C3–C4; one amplitude cycle every two seconds. |
| Engine Pulser | pulser, mechanical, tension | Hold C2–C4; 2 Hz gating for a steady mechanical bed. |
| Broken Relay | glitch, digital, short | Play short C3–C5 notes; sample-and-hold pitch and filter jumps. |
| Data Fragments | glitch, digital, thin | Play C4–C5 bursts with rests; highpass makes a thin brittle layer. |
| Corrupt Clock | glitch, unstable, rhythmic | Hold C3–C4; irregular timbre at a 4 Hz update rate. |
| Buffer Drift | glitch, slow, dark | Hold C3–C4 for several seconds; slow random pitch steps. |
| Suspended Steel | atonal, metal, tension | Hold C2–C4 single notes; inharmonic FM builds a suspended metallic bed. |
| Distant Gantry | atonal, vast, low | Hold C2–C3 for 6 seconds; add plate to suggest distance. |
| Wire Stress | atonal, thin, tension | Hold C3–C5; keep mixer level low beneath the scene. |
| Black Resonator | atonal, dark, vast | Hold C2–C3 for 8 seconds; slow inharmonic tension. |
| Passing Vapour | noise, whoosh, soft | Hold 1–2 seconds then release; manually place ahead of a cut. |
| Bright Air Riser | noise, riser, bright | Hold at least 1.5 seconds; short high-frequency transition. |
| Granular Hiss | noise, static, restless | Hold briefly at low mix level; fast drift roughens the filtered hiss. |
| Uneasy Scale | atonal, eerie, sparse | Play widely spaced C3–C5 notes; suggests scale of a space, not a tonal scale. |

## Extending the bank

Since #561 every scoring patch is one file,
`packages/client/src/audio/patches/score-<slug>.json`, holding the full
normalised patch with its category, tags, audition note (`description`)
and headroom record; the recipe rows and the voicing module that expanded
them were retired once the expanded patches were frozen as data
(decision record `2026-09-15-561-patch-library-file-shape`). The `score-…`
IDs are the filename slugs and stable song references: the display `name`
may change, the id never does.

`presetCatalog.ts` only lists and filters; metadata is the file's own and is
not part of the DSP patch or arrangement schema. Reuse existing tags where
they fit. For a new USER spectrum, supply a unique nonempty `userKey`: the
worklet cache keys on it, not on the partial array's contents.

After changing a sound, rewrite its headroom record and run the real-DSP
checks (from the repo root):

```sh
node tools/patch-editor/sweep-headroom.mjs <id…|--stale> [--seeds <n>]
npx prettier --write packages/client/src/audio/patches
npx vitest run packages/client/src/audio/patch/presetCatalog.test.ts packages/client/src/audio/patch/patchLibraryEnvelope.test.ts packages/client/src/audio/synth/fmProcessorHeadroom.test.ts tools/patch-editor/src/presetBrowser.test.ts
node tools/patch-editor/build-editor.mjs
```

The sweep's default is 16,384 seeds (about 6 s per patch on a dev machine);
`--seeds` lowers it and the count is written to the file as `seedsSwept`, so
a lighter sweep is a visible fact. It records the worst **sampled** seed and
is not an exhaustive bound. The bank's records carry the seeds they were
measured with: 16,384 for the original bank (4,096 for `saw-arp` and
`drone-sqr`) and 256 for the scoring bank. Long-note tests complement the short window: full attacks, decays and
release tails at low/middle/high notes, plus four-note chords. The intended
listening verdict still belongs to Pat; mechanical checks cannot establish
whether a sound fits the score.

The classic string-machine bank (`str-*`: Solina, Oberheim, Juno, D-50,
Jupiter-8, supersaw, ambient and stab strings for EDM, ambient and trance) is a
separate palette with its own research note,
`docs/research/2026-09-24-classic-string-machine-patches.md` (#686).
