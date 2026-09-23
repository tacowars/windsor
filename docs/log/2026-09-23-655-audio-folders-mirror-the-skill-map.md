# The audio directory is grouped into folders that mirror the music-engine skill's map

- Date: 2026-09-23
- Area: audio
- Links: issue #655 · builds on `2026-09-23-638-worklet-refactor-optimised-for-agents` (the item outside the epic) · the map is `.claude/skills/music-engine/SKILL.md` "Find the source of the behavior"

## Decision

`packages/client/src/audio/` is nine folders plus the four it already had,
and the skill's file map names one folder per row, so `ls` of the directory
*is* the map:

| Folder | Map row |
|---|---|
| `patch/` | patch schema and the library (`patches/` keeps the JSON) |
| `synth/` | the main-thread side of FM synthesis: engine, part, messages, the processor tests (`worklet/` keeps the DSP) |
| `song/` | song schema and compatibility |
| `sequencing/` | the transport and the generators |
| `harmony/` | chord theory, names, voicing, tables |
| `mixer/` | the desk, strips, buses, returns and the plate's tests (`inserts/` keeps the insert kinds) |
| `game/` | game selection and live changes, and the Babylon seam |
| `cost/` | the cost counters the overlay and the bench read — a row the map had not named |
| `sfx/` | the gameplay SFX path, which is not the music engine's |

At the root stay `index.ts`, `index-for-editor.ts`, `audioConstants.ts`,
`audioManifest.d.ts` and `__fixtures__/`. A pure move: no symbol renamed, no
file split, and every edit outside the moves is an import specifier, a path
string or a document.

1. **`__fixtures__/` stays at the root, unsplit.** Twelve of its nineteen
   files serve tests in three or more of the new folders, and `tools/`
   imports four of them; a per-folder split would put `../mixer/__fixtures__/`
   imports in `song/` tests, which is the opposite of the folder telling an
   agent where a thing lives.
2. **The pure-generator boundary judges an import by what it resolves to.**
   `generatorBoundary.test.ts` compared raw specifiers to `./<name>`; with the
   pure set across `sequencing/`, the root and `worklet/fm/`, it now resolves
   each specifier against the importing file and checks the absolute path.
   Same set, same forbidden identifiers.
3. **The client's few deep imports into `audio/` kept their shape.**
   `main.ts`, `stats.ts`, `stats/`, `settings/` and `bench/` import
   `createGameplaySfx`, `mixLevels`, `audioCost` and `playbackStats` by path,
   from before #655; the paths moved with the files. Routing them through
   `index.ts` would be a surface change and is not this ticket's.

## Why

The maintainers are agents that navigate by `ls`, grep and the map
(`2026-09-23-638-worklet-refactor-optimised-for-agents`). About 170 flat files
made the listing a wall and the map a list of every file; a folder per row
lets the map say what needs a note and the listing say the rest, and an
`area:audio` ticket's brief can now name a folder it owns.

## Punted / alternatives

- One folder per map row, with `sequencing/` and `harmony/` split as the
  ticket suggested (the map had one row for both; it now has two).
- A `measure/` or `overlay/` name for `cost/` — `cost` is the word the four
  files and the overlay line already use.
- Moving `tanhCurve.ts` into `inserts/` (the architecture doc calls it the
  inserts' shared curve): `returnBus.ts` in `mixer/` uses it too, so it sits
  with the mixer.
- Any change to what `index.ts` exports, or to the deep imports (decision 3).
