# The first built-in rack bank, for a listen (windsor#878)

The bank half of issue E of `docs/log/2026-10-17-racks.md` (decision 16),
on windsor#877's folder, index and loader. Eight racks are proposed here;
the racks tacowars keeps after listening are the bank, and the rest are
deleted from `packages/engine/src/racks/` before the merge (then
`node scripts/patch-library-index.mjs --write`).

## The bank

Each rack is one `packages/engine/src/racks/<id>.json` at
`RACK_FILE_FORMAT` 1, embedding the built-in patch named by `patchSource`
at `PATCH_FILE_FORMAT` 4, its leaves equal to the built-in's apart from
`name`. Category and tags are the patch entry's, plus one tag per effect
that defines the sound.

| id | name | patch | sequencer | chain | low cut |
|---|---|---|---|---|---|
| `driven-kick` | Driven Kick | `tr909-kick` | Euclid, four on the floor | Drive → Compressor | — |
| `dub-hat` | Dub Hat | `tr909-hat-closed` | Euclid, offbeat eighths and a pickup | Filter → Dub delay | — |
| `room-clap` | Room Clap | `tr909-clap` | Euclid, beats 2 and 4 | Reverb | — |
| `acid-line` | Acid Line | `acid-saw` | Basslead, follow root, 16 cells | Advanced Drive → Dub delay | — |
| `echo-stab` | Echo Stab | `str-edm-stab` | Chord Player, offbeat eighths | Chorus → Echo | 150 Hz |
| `pumping-pad` | Pumping Pad | `pad-drift` | Chord Player, one hit held four bars, follow on | Ensemble → Reverb → Pump (keyed `{ track: null }`) | 180 Hz |
| `phased-arp` | Phased Arp | `lead-sync-sweep` | Arp, up, two octaves, sixteenths | Phaser → Echo | 150 Hz |
| `tape-tom` | Tape Tom | `tr909-tom-mid` | Euclid with a pitch lane | Tape | — |

"—" leaves the loaded part's own low cut (decision 2).

### Against the issue's proposed eight

- **The external key moved from the kick to the pad, as a Pump.** A
  compressor on the kick keyed from another part would duck the kick, the
  part a techno mix keys everything else from. The idiom is the pad ducking
  under the kick, and Pump is the shipped tool for it
  (`docs/log/2026-10-13-pump-insert.md`, context). So `pumping-pad`
  carries the one external key, written `{ track: null }` (decision 3), and
  `driven-kick`'s compressor keys from its own input.
- **No Filter on the acid line.** The Biased acid starting point's second
  stage already runs its own resonant lowpass before its diode shaper
  (1.22 kHz, resonance 6, envelope-swept), so a Filter after it would be an
  insert the rack does not need (decision 4). The Filter went to the hat,
  where it is the sound.
- Everything else is the issue's list on the patches and starting points
  that ship.

## Where every value comes from

Each insert is a shipped starting point or its kind's defaults; the table
files cite their own sources.

| rack | insert | settings | source |
|---|---|---|---|
| `driven-kick` | Drive | defaults: drive 12, tone 8 kHz, mix 1 | `inserts/driveInsert.ts` |
| | Compressor | defaults: −12 dB, 4:1, 10 ms attack, auto release, internal key | `inserts/compressorSpec.ts` |
| `dub-hat` | Filter | **by hand**: highpass, 24 dB, 5 kHz, resonance 1.5, mix 1 | a starting point to ride; the kind has no presets and its defaults (an 18 kHz lowpass) do nothing |
| | Dub delay | Roots dub, mix 0.3 (the kind's) | `inserts/delayPresetTables.ts`, original starting points |
| `room-clap` | Reverb | 11 Club Toilets (room, T30 0.57 s), mix 0.3 (the kind's) | `inserts/reverbPresetsDrums.ts`, Windsor's own values measured in `docs/research/2026-10-12-reverb-preset-bank/` |
| `acid-line` | Advanced Drive | Biased acid, mix 1 and output 0 (the kind's) | `inserts/advancedDrivePresetTables.ts`, original recipes |
| | Dub delay | Tape echo, **mix 0.2 by hand** (the kind's is 0.3) so the repeats sit under the line | `inserts/delayPresetTables.ts` |
| `echo-stab` | Chorus | Slow (0.513 Hz, ±1.845 ms, spread 1), mix 0.5 (the kind's) | `inserts/chorusPresetTables.ts`, measurements of recordings by pendragon-andyh |
| | Echo | defaults: dotted eighths synced, feedback 0.3, damp 3.2 kHz, mix 0.3 | `inserts/echoInsert.ts` |
| `pumping-pad` | Ensemble | Deep (0.66 / 6.25 Hz, 1.5 / 0.4 ms, 8 ms centre), width and mix 1 (the kind's) | `inserts/ensemblePresetTables.ts`, a service manual's scope traces and Sound On Sound's review, as cited there |
| | Reverb | 18 Euphoria (plate, T30 3.42 s), mix 0.3 (the kind's) | `inserts/reverbPresetsPads.ts`, measured as above |
| | Pump | defaults: the drawn quarter-note duck, depth 1, sens 0.6, hold 80 ms; key `{ track: null }` | `inserts/pumpSpec.ts`, `inserts/pumpConstants.ts` |
| `phased-arp` | Phaser | Deep color, mix 0.5 (the kind's) | `inserts/phaserPresetTables.ts`, original starting points |
| | Echo | defaults, as above | `inserts/echoInsert.ts` |
| `tape-tom` | Tape | Metal punch (metal tape, drive 10, wow 2, flutter 1), oversampling 2 and mix 1 (the kind's) | `inserts/tapePresetTables.ts`, original starting points |

Set by hand, and said in each rack's description:

- **Low cuts**: 150 Hz on the stab and the arp and 180 Hz on the pad, the
  pad's raised as the issue asks, so nothing but the kick and the bass
  speaks below them. The drums and the bass leave the part's own.
- **Patterns** (`bank.mjs`): the four-on-the-floor kick, the hat's offbeat
  eighths with a sixteenth pickup, the clap on 2 and 4, the tom's
  syncopated figure (`x..x..x...x..x..`) and its pitch lane (+5, −2, +3
  semitones on the second, third and fourth hits), the acid line's sixteen
  cells, the stab's offbeat eighths at gate 0.5, the pad's one four-bar hit
  following the changes, the arp's accent on the first cell of each turn.
  Drum notes are C4, the pitch the drum patches are fitted on.
- **Registers**: the acid line in octave 2 (C2), the stab and the arp in
  octave 4, the pad in octave 3.

The recipes are `bank.mjs`; `author.mjs` reads each through the engine's
`loadRackFile` (filling every field a recipe leaves out from its kind's
defaults, refusing a clamp, a slot key or a patch that is not the
built-in's) and writes it with `serialiseRackFile` and then Prettier, as every
library file is written (`patch/patchFileSerialise.ts`).
`node docs/research/2026-10-18-rack-bank/author.mjs --check` fails when a
file has drifted from its recipe.

## The listen

    node docs/research/2026-10-18-rack-bank/listen.mjs [--out ~/Desktop/rack-bank] [--only id,id]

`listen-song.json` (version 18) is four bars at 128 BPM in C minor:
C minor for bars 1 and 2, A♭ major for bar 3, B♭ major for bar 4. Its one
part is a muted kick on slot 0 (`output: "sidechain"`, four on the floor),
there only as a key. Each rack is added to it as the console's **Add part
from rack** adds one (the app's `addPartFromRackChange`, decision 12); the
pad's disconnected key is then re-picked to the kick, as the user would
after a load (decision 3), and the part's velocity set to 1, so the
acid line's accents and slides and the arp's accents are heard. The new
part sends nothing to the returns, so each file is the rack alone.

The render is the console's own audio export, `runAudioExport` over the
engine's `renderSong` and `encodeWavAsync` at the export's defaults (48 kHz,
24-bit, stereo, a 2 s tail), in a headless Chromium. The WAVs go to
`~/Desktop/rack-bank/<id>.wav`; the script refuses a folder inside the
repository.

**Rendered on** a 4-core Intel Xeon (`/proc/cpuinfo`: "Intel(R) Xeon(R)
Processor") Linux cloud container with no audio device, Node v22.22.0,
Chromium 141.0.7390.37 headless (`--headless=new --no-sandbox`), offline
rendering (`OfflineAudioContext`), 2026-10-17.

| file | seconds | peak | RMS | clipped |
|---|---|---|---|---|
| `acid-line.wav` | 9.50 | −8.1 dBFS | −20.5 dBFS | 0 |
| `driven-kick.wav` | 9.50 | −10.2 dBFS | −22.1 dBFS | 0 |
| `dub-hat.wav` | 9.50 | −9.7 dBFS | −40.5 dBFS | 0 |
| `echo-stab.wav` | 9.50 | −12.6 dBFS | −29.9 dBFS | 0 |
| `phased-arp.wav` | 9.50 | −8.9 dBFS | −24.1 dBFS | 0 |
| `pumping-pad.wav` | 9.50 | −1.0 dBFS | −14.5 dBFS | 0 |
| `room-clap.wav` | 9.50 | −9.0 dBFS | −33.4 dBFS | 0 |
| `tape-tom.wav` | 9.50 | −1.7 dBFS | −16.7 dBFS | 0 |

The pad's Pump was checked in the file: 30 ms windows 10 ms after each
beat read 31–34 dBFS down, against 11–15 dBFS down at 70 % of the beat, a
duck of about 20 dB on every kick of the muted key.

### Pitches per bar

Read from the part as the player plays it (`renderBounceRegion`, the
player's own wiring); `!` is an accent. Drum notes trigger the fixed-pitch
drum at C4.

| rack | bar 1 | bar 2 | bar 3 | bar 4 |
|---|---|---|---|---|
| `driven-kick` | C4 ×4 | C4 ×4 | C4 ×4 | C4 ×4 |
| `dub-hat` | C4 ×5 | C4 ×5 | C4 ×5 | C4 ×5 |
| `room-clap` | C4 ×2 | C4 ×2 | C4 ×2 | C4 ×2 |
| `tape-tom` | C4 F4 B♭3 E♭4 C4 | the same | the same | the same |
| `acid-line` | C2 C3! C2 C2 C3 C2! C2 C2 C3! C3 C2! C3 C2 | as bar 1 | A♭2 A♭3! A♭2 A♭2 A♭3 A♭2! A♭2 A♭2 A♭3! A♭3 A♭2! A♭3 A♭2 | B♭2 B♭3! B♭2 B♭2 B♭3 B♭2! B♭2 B♭2 B♭3! B♭3 B♭2! B♭3 B♭2 |
| `echo-stab` | (C4 E♭4 G4) ×4 | (C4 E♭4 G4) ×4 | (A♭4 C5 E♭5) ×4 | (B♭4 D5 F5) ×4 |
| `pumping-pad` | C3 E♭3 G3 struck, held | held | G3 moves to A♭3 | B♭2 D3 B♭3 |
| `phased-arp` | C4! E♭4 G4 C5 E♭5 G5 C4! E♭4 G4 C5 E♭5 G5 C4! E♭4 G4 C5 | E♭5 G5 C4! E♭4 G4 C5 E♭5 G5 C4! E♭4 G4 C5 E♭5 G5 C4! E♭4 | E♭5 A♭5 C6 E♭6 A♭4! C5 E♭5 A♭5 C6 E♭6 A♭4! C5 E♭5 A♭5 C6 E♭6 | B♭4! D5 F5 B♭5 D6 F6 B♭4! D5 F5 B♭5 D6 F6 B♭4! D5 F5 B♭5 |

The acid line slides into cells 4, 6, 11 and 15 of its sixteen, each from
the note before it: a cell's `slide` flag glides that cell's note in from
the held one, and the note before runs to the slide's onset
(`bassSequencer.ts`, `holdsToNext`). Cell 4 glides down from the accented
octave of cell 3; cells 6, 11 and 15 glide up an octave. On a mono patch
with sustain 0.55. The arp's lead is
polyphonic, so its cells carry accents and no slides: a slide glides only
on a mono patch.

## Economy

Measured with `measure.mjs` on the machine above, 2026-10-17, in a headless
Chromium of its own: two rounds of 6 s live after a 3 s warm-up, and six
timed offline renders after a discarded warm-up, per case. Each rack is
added (as in the listen) to a **drum-heavy** song, seven Euclid drum lines
(the `tr909-*` kick, closed and open hats, clap, snare, ride and rimshot
patches), or a
**pad-heavy** one, four Chord Players holding three-note chords
(`pad-drift` twice, `str-ob-strings`, `str-solina-ensemble`), none with an
insert, all looping the listen song's four bars; then the same song with
the rack's chain emptied after the load. The rack's insert load is the
median of the paired differences.

- **Load** is the engine's own report, `AudioSystem.readout().load.loadPct`,
  the number the console's CPU meter shows: the processors' summed busy
  time over wall time, a `Date.now()` duty-cycle estimator that over-reads
  2–3× (`cost/audioLoad.ts`). It sees worklet processors only, so the
  native-node kinds (Drive, Chorus, Echo, Ensemble) read nothing in it; the
  processors column counts the worklets a chain adds. The live context
  here ran at 44.1 kHz (the container's fake output device); the clock
  rate held at 0.98 or above in every case.
- **Offline** is the whole `renderSong` call at 48 kHz, the export path,
  in ms of render per second of audio, which does include the native
  nodes. Single renders on this container stall now and then (a pair's
  difference reached ±900 ms/s), so a median within about ±30 ms/s of
  zero is noise here, as is a live median within about ±2 %.

| rack | chain | worklets | load, drums | load, pads | offline, drums | offline, pads |
|---|---|---|---|---|---|---|
| `driven-kick` | Drive → Compressor | 1 | +0.1 % | +0.3 % | +15 ms/s | +8 ms/s |
| `dub-hat` | Filter → Dub delay | 2 | +1.5 % | +1.3 % | +22 ms/s | +29 ms/s |
| `room-clap` | Reverb | 1 | +1.1 % | +1.7 % | +45 ms/s | −35 ms/s (noise) |
| `acid-line` | Advanced Drive → Dub delay | 2 | +6.7 % | +12.0 % | +111 ms/s | +139 ms/s |
| `echo-stab` | Chorus → Echo | 0 | −0.1 % | −1.2 % | +16 ms/s | +11 ms/s |
| `pumping-pad` | Ensemble → Reverb → Pump | 2 | +3.9 % | +0.9 % | +101 ms/s | +64 ms/s |
| `phased-arp` | Phaser → Echo | 1 | −1.0 % | −1.1 % | +13 ms/s | +33 ms/s |
| `tape-tom` | Tape | 1 | +8.7 % | +8.2 % | +120 ms/s | +123 ms/s |

The songs' own load with the rack's chain emptied read 2.6–8.8 % live and
136–201 ms/s offline (drums), 10.4–17.3 % and 228–325 ms/s (pads); the raw
readings of every round and render are in `measurement.json`.

Reading: three chains cost a tenth of a core or more offline, each by its
one dear insert: the Advanced Drive's acid recipe, the Tape at its default
2× oversampling, and the pad's Ensemble and long plate Reverb together
(the clap's short room costs less than half as much). They are the sound of those racks, so each stays; the Tape's
1× oversampling is the cheaper setting to try by ear if the tom must be
cheaper. Every other chain is within a few per cent. No rack carries an
insert it does not need: the Filter the issue proposed for the acid line
is left out (above), and every remaining insert is the effect the rack is
named for.

## Chunk size

`vite build` of `packages/app` (Vite 8.3.1) on this branch and on the same
tree with the empty index windsor#877 shipped: the bank's chunk,
`rackBank-*.js`, grows from 0.21 kB (0.19 kB gzip) to 30.17 kB
(5.35 kB gzip), fetched on demand; the entry chunk is 1,039.79 kB
(352.37 kB gzip) in both, so the bank adds nothing to the first load. The
eight files are 60 kB of JSON, the embedded patches most of it.

## Files

- `bank.mjs`: the recipes. `author.mjs`: writes or checks the rack files.
- `listen.mjs`, `listen-song.json`: the listen.
- `measure.mjs`, `measurement.json`: the economy and its raw readings.
- `page.mjs`, `pageEconomy.mjs`, `rackPart.mjs`: the page both run in.
  `browser.mjs`: the headless Chromium and the server.
  `engineBundle.mjs`: the engine's TypeScript for `author.mjs`.
