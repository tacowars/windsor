# The worklet refactor is optimised for AI coding agents as the code's maintainers

- Date: 2026-09-23
- Area: audio
- Links: epic #638 · #643, #644, #645 (amended) · #654, #656 (new, in the epic) · #655 (new, outside it) · amends `2026-08-31-audio-worklet-single-file` (takes up the split it punted) · `docs/agents/BOARD_GUIDE.md` · `CLAUDE.md` "Code structure"

## Decision

The FM worklet refactor (#638) is planned for the code's actual maintainers,
which are AI coding agents, and not for human readers. The line count that
prompted the epic is one agent cost among several; the plan now covers the
rest. What an agent pays for that a human does not:

- **Context per edit.** An agent reads the whole file before editing. The
  useful module size is 100–350 lines, the lint cap. Finer than that costs more
  reads than it saves.
- **Discovery, not memory.** An agent starts every session with no memory and
  finds code by `ls`, grep and the skill's file map. It finds a rule only if the
  rule sits in the file it edits or in a `CLAUDE.md` that loads for that
  directory.
- **Feedback, not judgement.** An agent iterates on failing checks. A prose
  rule is followed inconsistently; a test whose failure names the module and
  the refresh command is followed every time.
- **Duplication.** An agent edits one copy, a pin test fails, and it has to go
  and find the other copy.

Six consequences, written into the tickets:

1. **The generated file lives where grep does not find it first** (#643).
   `scripts/build-worklets.mjs` writes `worklet/generated/fm-processor.js`,
   the three consumers read it from there, and ESLint and Prettier ignore the
   folder. The ticket had kept the old path to spare the consumers a change;
   that spares a human a diff and invites an agent to edit the output. The
   `--check` failure text names the source folder and the rebuild command,
   because the error is what an agent reads.
2. **The source folder carries its own `CLAUDE.md`** (#643). Claude Code loads
   a nested `CLAUDE.md` whenever an agent touches a file under it. It is the
   one mechanism that puts the rules in front of every agent every time, so it
   states them in full: no allocation on the audio thread; bit-identity by
   construction with the #548 record's list of what breaks it; the output is
   generated; the golden test is the gate. The skill's map row points at the
   folder and stays one line.
3. **Bit-identity is a kept test, not a research script** (#643).
   `fmProcessorGolden.test.ts` renders every factory preset in all three modes
   (default, `specialise: false`, `dormancy: false`) and compares a hash of
   the Float32 bytes to a checked-in table, refreshed by a flag, with a failure
   message that says the render changed and how to refresh when that was
   intended. It lands from the unmoved file first so the table proves the
   move, and it guards every later DSP ticket, not only this epic. Precedent:
   `headroom.contentHash` (#586).
4. **Every module opens with its contract** (#644, #645): what it owns, the
   invariant it keeps, the test that pins it. The kernel stays one function in
   one file, read top to bottom, whatever `max-lines-per-function` says; the
   disable cites the #548 record.
5. **The modules become TypeScript** (#654, new, after #645). The 2026-08-31
   record declined TypeScript because compiling would put a build step between
   source and asset; #643 adds that step, so the reason is gone. The conversion
   brings the worklet under `tsc`, `max-lines`, `no-magic-numbers` and typed
   imports, which is the feedback the rest of the client already gives an
   agent, and it makes direct per-module tests possible. A conversion and a
   bit-identical move never share a PR.
6. **The three pinned duplications are removed** (#656, new, after #654). The
   algorithm table and waveform enums, the envelope curve, and if it can be
   done cleanly the PRNG, become one module each that the worklet bundle and
   the main thread both import. `patch.test.ts`'s mirror tests and
   `envelopeCurve.test.ts`'s worklet comparison retire. This is the largest
   maintainability win in the area and is reachable only through the bundle
   step.

Unchanged: the module cut the tickets already proposed (leaf units, then
`Voice` at per-render-call granularity), the three-ticket order, and the
bit-identical gate on every PR. Outside the epic, #655 groups the flat
`audio/` directory (about 170 files, four subfolders) into folders that mirror
the skill's map rows, scheduled when no audio PR is open.

## Why

Pat, 2026-09-23: "This code is entirely built and maintained by AI agents
though so I want to make sure that any review or refactor we do takes that
into account. We want the music engine to be organized so its easiest for AI
coding agents to work on it. I am not concerned with human coders needing it
to be easy to maintain for them."

The single-file record's reasoning was right for its moment and is now
reversed by its own terms: it punted the split "if the DSP grows a second
worklet, or wants to share code with the main thread beyond the schema". The
second worklet exists (the reverb), and sharing the tables is decision 6.

The tickets as first written were a human's refactor: smaller files, the same
prose rules in the same places, a one-time comparison. Each of the six items
above is where an agent's failure mode differs from a human's. An agent edits
the generated file because grep found the symbol there. An agent edits the
kernel without having read the #548 record. An agent does not rerun a script
under `docs/research/` unless `verify` does. An agent gets no `tsc` or lint
feedback from a plain-JS file. An agent edits one copy of a duplicated table.

## Punted / alternatives

- **Splitting finer than the lint cap, or slicing the kernel.** Rejected. A
  30-line module costs an agent a read without saving one, and a kernel cut
  into per-operator helpers is both slower (#548) and harder to hold in view.
- **Any new abstraction** (a stage registry inside the voice, generic operator
  objects). Rejected. Agents handle explicit, repetitive code well and generic
  indirection badly, and the fixed-index kernel exists because generic was
  slower. Growth points stay as data tables plus an appended entry, the shape
  the insert registry and the sequencer cards already use, with a test that
  fails when the entry is missing.
- **Relying on the header banner alone to protect the generated file.**
  Rejected as the weakest of three signals; it stays, beside the folder name
  and the `--check` text.
- **A tolerance instead of a hash in the golden test.** Rejected: the epic's
  rule is that one changed bit is a failed split. If the laptop and CI
  disagree on a hash, the #643 PR says so and decides; the fallback is a
  same-machine comparison of the three modes with the table pinned to CI's
  platform.
- **Linting the JS modules by widening the ESLint globs.** Rejected in favour
  of #654: the conversion gets the whole regime for free instead of a special
  case for one folder.
