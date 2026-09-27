# #70 arrangement console — browser verification

- Date: 2026-09-01
- Machine: Apple M4 Pro (macOS 25.5.0) — development machine, **indicative
  only** (CLAUDE.md invariant 3; the console is a dev tool, no milestone
  number is claimed here)
- Browser: Chrome via the `chrome-devtools` MCP (MCP-native path; the
  Claude-in-Chrome extension was not used)
- Subject: `tools/patch-editor/patch-editor.html` built by
  `node tools/patch-editor/build-editor.mjs` (238 KB; fm 38 KB, reverb 19 KB,
  app+engine bundle 164 KB)

The console has no Babylon and no game page, so the `?debug=1` bridge
protocol does not apply; evidence is MCP JSON (console listings, DOM
probes) plus screenshots for the maintainer.

## Origins exercised

1. `http://127.0.0.1:8791/patch-editor.html` (python3 http.server)
2. `file:///…/tools/patch-editor/patch-editor.html` (direct navigation)

Both: page renders all five tabs; `list_console_messages` **empty — zero
errors, zero warnings, zero issues** — after load, after enabling audio and
after every interaction below. `list_network_requests`: the document plus
Google Fonts only (no fetch of any app resource — the file is standalone).

One transient during the pass: opening the file:// page via the MCP's
`new_page` logged "Unsafe attempt to load URL file:… ('file:' URLs are
treated as unique security origins)" with a pending duplicate GET of the
page itself. A direct `navigate_page` to the same URL reproduces nothing —
the message comes from how the MCP opens tabs, not from the page. Treated
per the fresh-origin guidance in `docs/reference/browser-testing.md` §7.

## Findings fixed during the pass (console errors are findings)

- `file://` refuses **blob** worklet modules: `AbortError: Unable to load a
  worklet's module` at `FmEngine.init`. Fix: the host retries once with
  data URLs on a fresh context (`src/host.ts`; decision record
  `2026-09-01-captured-patterns-and-console-seams.md` §6).
- The Arrangement tab's live readout never started: its `isConnected` guard
  ran before the section was attached. Fix: deferred first tick.
- 13 form fields without id/name (a DevTools issue): named every
  select/input the console creates.

## Evidence (MCP JSON, both origins unless noted)

- Enable audio → `#status` = `drone sounded (tick 0)`, power = `Audio on`;
  readout (Arrangement tab) = `running — bpm 96 — root 50 — kick 9 · hat 18
  · arp 24 · drone 2` after ~5 s — **identical on both origins**, which is
  the determinism the one-seed design promises.
- Sequencers tab, kick **Capture** (http): pattern row `generative` →
  `x...x...x...x...` (E(4,16), the sounding figure), button → `Release`;
  status `kick: captured — the sounding bar is now a literal array in the
  document`. **Release** returns it to `generative`.
- Arrangement tab (file://): **Export** downloads `bed-01.json` (status
  `exported bed-01.json`); **Import** of a kick-only bpm-72 document via the
  file input rebuilds the system — readout `running — bpm 72 — root 50 —
  kick 5 · hat 0 · arp 0 · drone 0` (only the imported part plays, #75's
  optional slots end to end).
- Mixer tab probe: 4 strips (kick/hat/arp/drone) × Level·Pan·→room·→echo,
  plus return Level knobs, echo Time and the room space `<select>`.
- Harmony tab probe: Root knob, 7 degree-weight knobs (D E F G A B C —
  dorian on root 50), scale select = `dorian`, Octave/Span per pitched part.

## Game page (scope:client protocol — bridge evidence, both backends)

The PR also changes runtime modules under `packages/client/src/audio`
(generator `pattern` playback, player recorder, normaliser field), so the
standard game-page pass ran too: bridge daemon up first, Vite dev server,
`chrome-devtools` MCP `new_page` on `?debug=1` and `?debug=1&backend=webgl2`.

- `get-system-stats`: session 1 `WebGPU1`, `[a204] engine` event
  `"gpu":"apple metal-3 unknown version"`; session 2 `WebGL2 - Parallel
  shader compilation`, driver `ANGLE (Apple, ANGLE Metal Renderer: Apple M4
  Pro …)` — real hardware drivers on both, no SwiftShader/llvmpipe.
- `query-a204-state` before and after `a204-motor {"x":0,"z":6,"seconds":3}`:
  player z 32.03 → 49.83 on both backends, `support: "supported"`,
  0 fallthroughs.
- One bridge `take-screenshot` per backend (`game-webgpu-after-move.png`,
  `game-webgl2-after-move.png`) — composition evidence only; backend proof
  is `get-system-stats` and the `[a204] engine` event, never the PNG.
- A trusted canvas click on the WebGPU page unlocked audio: `[a204]
  {"event":"music","state":"started","bpm":96,"root":50,"scale":"dorian"}`
  followed by note events for **all four parts** — the committed document
  still plays through the game's own path with this PR's engine changes.
- `list_console_messages`: zero errors/warnings apart from (a) the second
  Babylon engine banner at the first screenshot — the documented `DumpTools`
  PNG encoder, not a stray engine (§5) — and (b) an `unhandledrejection`
  `WrongDocumentError` from `requestPointerLock()` under the automated
  click. That was a real pre-existing gap (Chrome returns a promise,
  `input.ts` discarded it unhandled); fixed in this PR by catching the
  refusal, and clean on re-test. `list_network_requests`: Vite module
  serving only, no failures.

## Screenshots (composition evidence for the maintainer)

- `console-http-parts.png` — Parts tab, audio on (http origin)
- `console-http-sequencers-captured.png` — Sequencers tab after
  capture/release drive (http origin)
- `console-file-arrangement-imported.png` — Arrangement tab after the
  import probe (file:// origin)
