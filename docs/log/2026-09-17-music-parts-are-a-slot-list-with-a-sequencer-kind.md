# Music parts are a slot list, each with any sequencer kind

- Date: 2026-09-17
- Area: audio
- Links: issue #597 · follow-up #598 · `2026-08-31-arrangement-document-schema-and-optional-parts` ·
  `2026-08-31-generative-sequencing-transport-and-pitch` (§4 seeds) ·
  `2026-09-11-music-document-carries-patches-and-returns` ·
  `2026-09-15-562-song-documents-are-self-contained`

## Decision

A song document is **version 2**: a list of 1–8 `parts`, and any part may carry
any sequencer. The four fixed slots (`kick`, `hat`, `arp`, `drone`), each of
which fixed its sequencer, and the top-level `mix` overlay are retired and no
longer read.

- **A part is `{ slot, name, preset, velocity, strip, sequencer }`.** `slot` is
  an integer 0–7, unique in the song; the list order is display order. A
  duplicate or missing slot drops the part (reported), since an identity has no
  default.
- **The slot is the identity; the name is a label.** The engine part and its
  strip are registered as `music-<slot>`, live partials address a part by slot
  (`{ parts: { 2: {...} } }`), and a part may be renamed live. A slot change,
  or adding or removing a part, is refused as a live partial; the console
  rebuilds for those.
- **The slot is the generator index.** It replaces `GENERATOR_INDEX`, so
  removing, reordering or renaming one part never moves another's note stream.
  The conversion kept the old indices (kick 0, hat 1, arp 2, drone 3), which is
  why bed-01 is sample-identical.
- **`sequencer.kind` is `euclidean | arp | step | none`.** Each kind carries its
  generator's driver fields. `euclidean` also carries `note` and `hold` (it
  stays a fixed-note trigger wherever it sits, per tacowars), and a note or hold
  change does not rebuild its stream. A kind change replaces the sequencer
  wholesale and rebuilds only that part. An absent sequencer normalises to
  `none`, silently.
- **`none` is inert (tacowars, 2026-09-17).** A `none` part builds its engine part
  and strip, so the keyboard and MIDI can play it, and every sequencing path
  skips it, reseeds included. It is allowed anywhere, including a committed
  song. `isShippable` still requires at least one sequenced part, so a song made
  only of `none` parts fails the verify gate the way an empty song always has.
- **Each part owns its strip** (tacowars's choice over a name-keyed `mix` section).
  A strip normalises over `DEFAULT_STRIP`; a send to an undefined return is
  dangling. `MIX` keeps only the SFX strips.
- **Old files are converted once, not read (tacowars's choice).** The four-slot
  shape normalises to unusable with a correction naming the retired format.
  `bed-01.json` was converted by a one-time script and proved sample-identical
  against a baseline captured on the four-slot code: master, plate and delay
  hashes over 8 bars, onset counters, and every message posted to each part.
  Per the #583 rule, the script and that test are removed in the PR's final
  commit.
- **Removing a part prunes its embedded patch only when no remaining part plays
  the same preset id** (`removePart`, `documentParts.ts`). Two parts may share
  one patch.

## Why

tacowars wants any arrangement of sequencers, such as four arpeggiators, or three
Euclidean parts and a drone, and a part count that follows the piece rather
than the code. Keying parts by a slot number, not a name, keeps the two
guarantees the four-slot design had: a stable per-part random stream, and a
live edit that cannot land on the wrong part. It also frees the name to be what
a musician calls the part.

## Punted / alternatives

- **The console's add/remove/kind picker and its empty-song boot are #598.** In
  #597 the console was ported to render the part list, and its per-slot on/off
  toggles were removed with the fixed slots. Until #598 lands, a part is added
  or removed by editing the JSON.
- **A pitched Euclidean sequencer** (drawing from the key on each onset) was
  offered and declined: the fixed note already has its knob.
- **Reading the old format alongside the new** was declined: bed-01 is the only
  committed song, and a second reader would outlive its one use.
- **Cost of an 8-part song** has not been measured. Each part is one worklet
  node with `MUSIC_PART_MAX_VOICES` voices. The next milestone reading should
  include an 8-part document.
