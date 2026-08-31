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

## Screenshots (composition evidence for the maintainer)

- `console-http-parts.png` — Parts tab, audio on (http origin)
- `console-http-sequencers-captured.png` — Sequencers tab after
  capture/release drive (http origin)
- `console-file-arrangement-imported.png` — Arrangement tab after the
  import probe (file:// origin)
