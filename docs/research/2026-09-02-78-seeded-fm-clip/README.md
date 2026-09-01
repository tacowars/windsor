# #78 seeded FM worklet + preset clip headroom — browser verification

- Date: 2026-09-02
- Machine: Apple M4 Pro (macOS 25.5.0) — development machine, **indicative
  only** (CLAUDE.md invariant 3). No milestone number is claimed here; the
  change is a test-determinism fix and four preset volume trims, and nothing
  in it is a frame-budget or dropout claim.
- Browser: Chrome via the `chrome-devtools` MCP (`--isolated=true` from the
  repo `.mcp.json`); the Claude-in-Chrome extension was not used.
- Backends exercised: WebGPU (default) and WebGL2 (`&backend=webgl2`).

```
Served build:  a48f298   (gitCommit from query-a204-state, both pages)
Worktree HEAD: a48f298   — match (tracked files clean)
Served on:     http://localhost:5251/   (client port 5173 + 78 % 100)
World server:  ws://localhost:8158/     (server port 8080 + 78 % 100)
```

`a48f298` is the branch's last commit that touches anything the browser runs.
Only this evidence directory lands after it.

## Ports, and the shared bridge

Ports are derived from the ticket number per #103 decision 2 and were passed
explicitly (`--port 5251 --strictPort`, `PORT=8158`); 5251 and 8158 were free
beforehand.

**The bridge daemon was not this session's.** `:4400` was held by a daemon
started from `/Volumes/Sendai/code/Aotearoa204-wt-124` — a sibling agent's
worktree — with its own live sessions on it. Per the protocol a busy `:4400`
is a queue rather than a wall: this session registered its own sessions
against that daemon (ids **4** and **5**, identified by their `gitCommit`
rather than by name, since the sibling's page also reports as
"Aotearoa204 WebGPU") and every command below was addressed to those ids.
**Nothing was stopped at teardown**: `--stop` is global and would have killed
the sibling's run.

The browser is likewise shared — `list_pages` showed the sibling's pages on
`:5197` and `:5193`. Every action here was addressed to a page id matched by
its `:5251` URL.

## Why a browser pass at all

The change is in `packages/client/src/audio/worklet/fm-processor.js`, which
Vite emits as an asset and the page loads with `AudioWorklet.addModule()`.
The Node harness under `vitest` evaluates that file in a shim, so the only
thing that proves the real worklet still parses, still registers and still
sounds is a page. It also lets the harness's numbers be checked against the
browser's.

## Evidence

| File | What it shows |
|---|---|
| `get-system-stats-webgpu.json` | `engine: WebGPU1` |
| `get-system-stats-webgl2.json` | `engine: WebGL2 …`, `driver: ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro …)` — a hardware driver, not SwiftShader |
| `query-a204-state-start-*.json` | identity (`gitCommit a48f298`), player at (32, 32) supported |
| `motor-*.json`, `query-a204-state-after-move-*.json` | scripted `a204-motor {"x":0,"z":6,"seconds":3}` → z 32 → 50.0, still `supported` |
| `game-webgpu.png`, `game-webgl2.png` | composition; `take-screenshot` is an offscreen render-target capture, so it cannot say *which* backend drew it — `get-system-stats` is the evidence for that (#26) |
| `console-webgpu.txt`, `console-webgl2.txt` | the verbatim `list_console_messages` listings and the resource-timing pairing |
| `worklet-peaks-in-browser.json` | the audio measurement, below |

**Console: zero errors, zero warnings, zero issues on both pages**, in the
full unfiltered listing taken after everything else.
`performance.getEntriesByType('resource')`: 250 resources on each page, **no
status ≥ 400** — the warm-cache trap in `browser-testing.md` §7 does not
apply here. One known non-fault in each listing: a second Babylon banner
(`WebGL2 - Parallel shader compilation`) logged at the first
`take-screenshot`, which is the `DumpTools` PNG encoder (§5).

## The audio itself

Both pages: a keypress supplies the gesture the autoplay policy needs, and
`[a204] {"event":"music","state":"started","bpm":96,…}` follows, then a `note`
line per part. `__a204.audio.readout()` after ~4 s: `running: true`, four
parts counting onsets. So the rebuilt worklet loads, registers `fm-part` and
sounds.

`worklet-peaks-in-browser.json` renders the presets through the *real*
AudioWorklet in an `OfflineAudioContext` at the same rate, length, note and
velocity the vitest harness uses:

- the same seed gives byte-identical peaks (`seed 7` twice: 0.6700881719589233
  both times), and a different seed a different peak;
- **no** seed still free-runs from `Math.random` — two unseeded renders differ
  — which is the game path, unchanged;
- each trimmed preset at its **recorded worst seed** matches the offline
  16,384-seed sweep to seven decimals: `bass-digital` 0.8638486 (seed 12428),
  `weapon-zap` 0.9355716 (1261), `ai-voice` 0.9371676 (11629), `horde-horn`
  0.9342034 (14891) — so the 6.1–6.6 % headroom is the browser's number;
- `bass-digital` at the phase-space worst case is 0.9393108, matching the
  harness's bound to four decimals.

Both backends produce identical audio figures, as they must: the AudioWorklet
runs on the audio thread and does not touch the GPU.

## Teardown

Both pages closed by URL; the dev server and world server killed by the PIDs
this session launched. The bridge daemon was **left running** — this session
did not start it and a sibling agent had live sessions on it.
