# Ticket #68 — sends, returns and channel strips: browser verification

Evidence that the client boots with the rebuilt audio graph -- `AudioSystem.init()`
now loads both worklets, builds the dry music bus, and constructs the two
returns (the `SPACES.hall` plate at 100 % wet and the feedback delay) into the
master -- on both backends, on a hardware driver, with a clean console. The
mixer's behaviour (per-part sends, pre-pan taps, the rotation's energy
preservation) is asserted by the vitest suite on the headless graph stand-in
(`packages/client/src/audio/audioSystem.test.ts`, `stereoRotate.test.ts`), not
here; nothing in the client creates a part yet, so this graph is silent by
design (#69 listens).

**Indicative only** -- development machine, not the target box. No frame or
audio-cost number is claimed: audio cost on the target (Ryzen 5600G / Vega 7) is
unmeasured and outside every milestone reading (bench mode runs without audio).

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro, macOS 26.5.1 -- **not** the target |
| Browser | Google Chrome 151.0.7922.175, headed, own profile (`/tmp/a204-68-chrome`) with `--remote-debugging-port=9333` |
| Page | `npm run dev:client` from the ticket worktree, `http://localhost:5173/?debug=1` (WebGPU) and `&backend=webgl2` |
| Bridge | `npx babylon-inspector` daemon on 4400/4401, sessions `[1] Aotearoa204 WebGPU`, `[2] Aotearoa204 WebGL2` |
| Build | branch `feature/68-audio-mixer-sends` |

**Why CDP scripts and not the `chrome-devtools` MCP.** `new_page` refused:
the MCP's browser profile (`~/.cache/chrome-devtools-mcp/chrome-profile`) was
held by a parallel session, and killing another session's browser is not an
option. As in #57 (`docs/research/2026-08-31-57-m3b-client-horde/`), a
separate Chrome instance was launched on its own profile and the two listings
the MCP would produce were taken over CDP:

- `cdp-collect.mjs` (copied from #57) opens a **new tab** per backend and
  records every console message, `Log` entry and network response for 20 s
  from navigation -- the `list_console_messages` / `list_network_requests`
  pair, on a fresh tab so a cached failed request cannot hide (§7).
- `cdp-console.mjs` (new) attaches to the **existing** tab afterwards and
  dumps the console Chrome replays on `Runtime.enable`, so the listing also
  covers what the bridge commands logged: the scripted move and the
  screenshot.

The bridge commands themselves ran through `npx babylon-inspector` exactly as
§8 prescribes.

## Against the review gate

| Required | WebGPU | WebGL2 |
|---|---|---|
| `get-system-stats`, hardware driver named | `webgpu/system-stats.json`: `engine: "WebGPU1"` (driver is empty on WebGPU by design; `gpu: "apple metal-3"` in `state-before.json` and the `[a204] engine` event) | `webgl2/system-stats.json`: `driver: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, …)"` |
| `query-a204-state` at start | `webgpu/state-before.json` -- player (31.94, 20.02, 32.03), `support: supported` | `webgl2/state-before.json` -- same seed, same start |
| scripted move | `webgpu/motor.json` -- `a204-motor {"x":0,"z":6,"seconds":3}` → 180 ticks | `webgl2/motor.json` -- 180 ticks |
| `query-a204-state` after the move | `webgpu/state-after.json` -- player z 32.03 → 49.83, still `supported` | `webgl2/state-after.json` -- z 32.03 → 49.83 |
| `take-screenshot` (composition only, #26) | `webgpu/boot.png` (960×540) | `webgl2/boot.png` (960×540) |
| console: zero errors, zero warnings | `webgpu/listings.json` -- 7 messages, `consoleErrorsOrWarnings: []`, `logErrorsOrWarnings: []`; `webgpu/console-after.json` -- 8 messages, none bad | `webgl2/listings.json` -- 7 messages, none bad; `webgl2/console-after.json` -- 8 messages, none bad |
| network listing beside the console | `webgpu/listings.json` -- 319 requests, `networkNotOk: []` | `webgl2/listings.json` -- 316 requests, `networkNotOk: []` |

The eighth message in each `console-after.json` is the `WebGL2 - Parallel
shader compilation` engine banner at the moment of `take-screenshot`: the
`DumpTools` PNG encoder (§5), expected, not a second engine. On the WebGPU
page it appears under the `WebGPU1` banner, as documented.

## What this says about the audio graph

`main.ts` constructs `AudioSystem` and awaits `init()` inside a guard that logs
`console.warn('[a204] audio unavailable, continuing without it:', …)` on any
failure. `init()` now does more than before this ticket: after both
`addModule` calls it builds the highpass music bus, then
`createReturns(RETURNS, master)`, which constructs an `AudioWorkletNode`
named `dattorro-reverb` (throws if the module did not register) and the
delay loop. Neither listing contains that warning on either backend, so the
returns were built in a real `AudioContext` on both. The graph is otherwise
mute -- no code calls `createMusicPart` or `createSfxPart` yet -- which is
the ticket's stated shape.

## Files

```
README.md                  this file
cdp-collect.mjs            #57's collector, unchanged: new tab, 20 s of console + Log + network
cdp-console.mjs            attach to the existing tab and dump the replayed console
webgpu/                    listings.json, console-after.json, system-stats.json,
                           state-before.json, motor.json, state-after.json, boot.png
webgl2/                    the same seven files for the WebGL2 page
```
