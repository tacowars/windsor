# #78 seeded FM worklet + bass-digital headroom — browser verification

- Date: 2026-09-02
- Machine: Apple M4 Pro (macOS 25.5.0) — development machine, **indicative
  only** (CLAUDE.md invariant 3). No milestone number is claimed here; the
  change is a test-determinism fix and a −1.68 dB preset trim, and nothing in
  it is a frame-budget or dropout claim.
- Browser: Chrome via the `chrome-devtools` MCP (`--isolated=true` from the
  repo `.mcp.json`); the Claude-in-Chrome extension was not used.
- Backends exercised: WebGPU (default) and WebGL2 (`&backend=webgl2`).

```
Served build:  d0cca67   (gitCommit from query-a204-state, both pages)
Worktree HEAD: d0cca67   — match (tracked files clean; only untracked
                           78-*.mts measurement scratch present)
Served on:     http://localhost:5251/   (client port 5173 + 78 % 100)
World server:  ws://localhost:8158/     (server port 8080 + 78 % 100)
```

Ports are derived from the ticket number per #103 decision 2 and were passed
explicitly (`--port 5251 --strictPort`, `PORT=8158`). `lsof` showed 5251,
8158, 4400 and 4401 all free before anything started, so no sibling agent was
serialised behind or in front of this run; the bridge daemon was started by
this session.

## Why a browser pass at all

The change is in `packages/client/src/audio/worklet/fm-processor.js`, which
Vite emits as an asset and the page loads with
`AudioWorklet.addModule()`. The Node harness under `vitest` evaluates that
file in a shim, so the only thing that proves the real worklet still parses,
still registers and still sounds is a page. It also lets the harness's numbers
be checked against the browser's.

## Evidence

| File | What it shows |
|---|---|
| `get-system-stats-webgpu.json` | `engine: WebGPU1` |
| `get-system-stats-webgl2.json` | `engine: WebGL2 …`, `driver: ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro …)` — a hardware driver, not SwiftShader |
| `query-a204-state-start-*.json` | identity (`gitCommit d0cca67`), player at (32, 32) supported |
| `motor-*.json`, `query-a204-state-after-move-*.json` | scripted `a204-motor {"x":0,"z":6,"seconds":3}` → z 32 → 50.0, still `supported` |
| `game-webgpu.png`, `game-webgl2.png` | composition; `take-screenshot` is an offscreen render-target capture, so it cannot say *which* backend drew it — `get-system-stats` is the evidence for that (#26) |
| `worklet-peaks-in-browser.json` | the audio measurement, below |
| `console-webgpu.txt`, `console-webgl2.txt` | the verbatim `list_console_messages` listings, plus the resource-timing pairing |

**Console: zero errors, zero warnings, zero issues on both pages**, checked
after load, after the audio gesture and after every bridge command
(`list_console_messages` filtered to error/warn/issue returned nothing). The
two `console-*.txt` files carry the listings verbatim, with the point in the
run each was taken at.
`performance.getEntriesByType('resource')` on the WebGPU page: 250 resources,
**no status ≥ 400** — the warm-cache trap in `browser-testing.md` §7 does not
apply here. One known non-fault appears in the WebGPU page's full listing: a
second Babylon banner (`WebGL2 - Parallel shader compilation`) logged at the
first `take-screenshot`, which is the `DumpTools` PNG encoder (§5).

## The audio itself

Both pages: a keypress supplies the gesture the autoplay policy needs, and
`[a204] {"event":"music","state":"started","bpm":96,…}` follows, then a `note`
line per part. `__a204.audio.readout()` after ~4 s on the WebGL2 page:
`running: true`, counters `kick 21 · hat 50 · arp 68 · drone 5`. So the
rebuilt worklet loads, registers `fm-part` and sounds four parts.

`worklet-peaks-in-browser.json` renders `bass-digital` through the *real*
AudioWorklet in an `OfflineAudioContext` at the same rate, length, note and
velocity the vitest harness uses:

- the same seed gives byte-identical peaks (`seed 7` twice: 0.6700881719589233
  both times), and a different seed a different peak;
- **no** seed still free-runs from `Math.random` — two unseeded renders differ
  — which is the game path, unchanged;
- the default-seed peak (0.5915170) and the worst-case-phase peak (0.9393108)
  match the Node harness to four decimals, so the 6.1 % headroom the trim buys
  is the browser's number and not an artefact of the test shim.

Both backends produce identical audio figures, as they must: the AudioWorklet
runs on the audio thread and does not touch the GPU.

## Teardown

Both pages closed by URL; the dev server and world server killed by the PIDs
this session launched; the bridge daemon stopped only after
`npx babylon-inspector --session` reported no remaining sessions (this session
started it — `:4400` was free beforehand).
