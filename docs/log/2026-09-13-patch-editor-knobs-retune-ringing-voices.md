# Patch editor knobs retune ringing voices; the game keeps note-on binding

- Date: 2026-09-13
- Area: audio
- Links: PR (this change) · record `2026-09-11-music-document-carries-patches-and-returns`

## Decision

A `Voice` in `worklet/fm-processor.js` binds its patch at note-on and, by
default, keeps that reference until it finishes. That stays the default: the
game swaps presets rarely, and a ringing voice keeping its old patch is what
stops the swap from clicking.

The arrangement console wants the opposite. A knob there already pushes the
working patch on every pointer move — through the document, `setPatch` and
the `'patch'` message — but nothing sounding picked it up, so the change was
heard on the next note, which with a held key is the moment the knob is
released. The processor therefore gains one switch, `liveRetune`, off unless
a `{ type: 'liveRetune', enabled: true }` message turns it on. With it on, a
`'patch'` message also calls `Voice.rebind()` on every active voice: the
patch, algorithm, operator kinds and wavetables are re-pointed and the
envelopes re-`configure`d, while phase, amplitude ramps and envelope stages
carry on. The console's `EngineHost` sends the message to every part after a
build (`FmEngine.setLiveRetune`); the game never sends it.

## Why

- The voice already reads almost everything from its patch every control
  block — operator ratio, detune, level, key and velocity scaling, LFO
  routing, glide, filter cutoff, resonance, mode, drive, feedback, volume.
  Re-pointing the reference is the whole change for those knobs; no
  per-parameter plumbing and no allocation on the audio thread.
- Envelopes hold a reference to their parameter block, and `configure()`
  swaps that block without touching the stage or value, so a held note takes
  new decay and sustain values without restarting its attack.
- A message rather than a construction option, because the console reuses
  the game's `FmEngine.createPart` path and rebuilds parts on every
  structural edit; one call after the build covers them all.
- A behavioural default kept in the game rather than "always live", because
  a wave or algorithm change under a ringing voice steps audibly. That is
  acceptable while designing a sound and not during a preset swap in play.

## Punted / alternatives

- Crossfading a retuned voice against its old patch to hide a wave or
  algorithm step. Two voices' worth of work per ringing note for an
  editor-only comfort; not worth it until someone hears the step and minds.
- Making retuned wavetable switches phase-continuous per mip. The existing
  per-block mip pick in `updateControl` already picks the right table on the
  next control block; the one-block delay is inaudible.
- A per-knob "audition" retrigger in the console instead of live retune.
  Would have given the same feel for percussive patches only and none for
  pads and drones, which are what the knob-turning is usually for.
