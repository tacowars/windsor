# The aux bus replaces the game's SFX route

- **Date:** 2026-09-27
- **Status:** accepted
- **Supersedes:** the first known follow-up in
  `2026-09-27-windsor-forked-from-aotearoa204.md`

## Context

Aotearoa204 routed its gameplay sounds through a second fader beside the
music bus: `AudioSystem.createSfxPart(name, id)` built a part on a strip whose
dry path went to an SFX gain and then the engine master, skipping the song
master. `patch/gameplayPatches.ts` named the two patches game code played
(`weapon-zap`, `pickup-blip`) by id, and the fallback click borrowed one of
them. Windsor has no game code: nothing called `createSfxPart` or
`setSfxGain`, and the console's Delete guard was protecting two ids for a
caller that no longer exists.

The route itself is still useful to a DAW. A sound outside the song, such as
a library audition, a metronome or a UI click, should not pass the song
master's inserts or be moved by its fader.

## Decision

Generalise the route. Pat chose this over removing it.

1. **The aux bus.** `createSfxPart` becomes `createAuxPart(name, patch,
   maxVoices)`, and `setSfxGain` / `sfxGain` become `setAuxGain` / `auxGain`.
   The graph doesn't change: a strip, then one `GainNode` at unity, then the
   engine master. The part takes a `Patch` from its caller, as
   `createMusicPart` does, so the engine resolves no library name for it
   (#562).
2. **The desk table.** `MIX` names the aux strips `audition` and `ui`, and the
   game's `place` strip is gone. Music parts still carry their own strips in
   the song (#597).
3. **One engine-named patch.** `patch/gameplayPatches.ts` becomes
   `patch/fallbackPatch.ts`, which exports `FALLBACK_PATCH_ID` and
   `FALLBACK_PATCH`: the fallback click's patch, statically imported from its
   own file. It remains the only preset id engine code may spell, and
   `fallbackPatch.test.ts` enforces that. The console's Delete guard refuses
   that one id.
4. **The patch files stay.** `pickup-blip.json`, `weapon-zap.json`,
   `build-thunk.json` and `horde-horn.json` remain library files. The goldens
   pin them, and songs may embed them. Their "Legacy game FX" category and
   tags are a separate follow-up.

## Consequences

- `@windsor/engine` no longer exports `GAMEPLAY_PATCHES`,
  `GAMEPLAY_PATCH_IDS` or `GameplayPatchId`. It exports `FALLBACK_PATCH` and
  `FALLBACK_PATCH_ID` instead.
- The fallback click still plays `pickup-blip`, so its sound is unchanged.
- The app has no aux caller yet. An audition or a metronome would be its
  first.
