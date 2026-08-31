# Ticket #69 — the audible arrangement: browser verification

Evidence that the client is audible: the four generative parts (dry kick,
echoed hat, bell arp into the hall, bar-long sub drone) build on both
backends, the music starts at the unlock gesture, `__a204.audio.apply` tunes
the transport live, `M` mutes and unmutes, and `?music=0` yields a silent
client with the whole graph still built. The audible acceptance criteria —
per-return energy attribution (hall from arp and drone, delay from hat only,
kick dry), tie behaviour, apply semantics — are asserted by the vitest suite
on the headless graph stand-in (`musicRender.test.ts`,
`arrangementPlayer.test.ts`, `arrangementApply.test.ts`), not here.

**Indicative only** — development machine, not the target box. No frame or
audio-cost number is claimed: audio CPU on the target (Ryzen 5600G / Vega 7)
is unmeasured and outside every milestone reading (bench mode builds no
audio). Whether the defaults are *musical* is the listening gate — Pat's
ear, not this record.

## Machine and browser

| | |
|---|---|
| Machine | Apple M4 Pro, macOS 26.5 — **not** the target |
| Browser | Google Chrome 151.0.7922.175, headed, own profile (`/tmp/a204-69-chrome`) with `--remote-debugging-port=9333` |
| Page | `npm run dev:client` from the ticket worktree, `http://localhost:5173/?debug=1` (WebGPU), `&backend=webgl2`, and `&music=0&bridge=0` |
| Bridge | `npx babylon-inspector` daemon on 4400/4401, sessions `[1] Aotearoa204 WebGPU`, `[2] Aotearoa204 WebGL2` |
| Build | branch `feature/69-audible-arrangement`, served commit `7929d64` (asserted by `query-a204-state.gitCommit`) |

**Why CDP scripts and not the `chrome-devtools` MCP.** `new_page` refused:
the MCP's browser profile (`~/.cache/chrome-devtools-mcp/chrome-profile`) was
held by a parallel session, and killing another session's browser is not an
option. As in #68 and #57, a separate Chrome was launched on its own profile
and the MCP's two listings were taken over CDP:

- `cdp-collect.mjs` (from #57/#68, unchanged) opens a **new tab** per page
  and records every console message, `Log` entry and network response from
  navigation — the `list_console_messages` / `list_network_requests` pair on
  a fresh tab, so a cached failed request cannot hide (§7).
- `cdp-console.mjs` (from #68, unchanged) attaches to the existing tab
  afterwards and dumps the console Chrome replays, covering what the bridge
  commands logged.
- `cdp-drive.mjs` (new, this ticket) walks the audible flow: a synthesized
  `KeyP` keydown — which Chrome counts as user activation, so it is the
  real unlock path — then `apply({bpm:90})`, `apply({bogus:1})`, and two
  `KeyM` presses, dumping `__a204.audio.readout()` at every step plus the
  console seen during the drive.

The bridge commands themselves ran through `npx babylon-inspector` exactly
as §8 prescribes.

## Against the review gate

| Required | WebGPU | WebGL2 |
|---|---|---|
| `get-system-stats`, hardware driver named | `webgpu/system-stats.json`: `engine: "WebGPU1"` (driver empty on WebGPU by design; `gpu: "apple metal-3"` in `state-before.json` and the `[a204] engine` event) | `webgl2/system-stats.json`: `driver: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, …)"` |
| `query-a204-state` at start | `webgpu/state-before.json` — player z 32.03, `support: supported`, `gitCommit: 7929d64` | `webgl2/state-before.json` — same seed, same start, same commit |
| scripted move | `webgpu/motor.json` — `a204-motor {"x":0,"z":6,"seconds":3}` → 180 ticks, z 32.03 → 49.83 | `webgl2/motor.json` — 180 ticks, z → 67.57 (see note) |
| `query-a204-state` after the move | `webgpu/state-after.json` — still `supported` | `webgl2/state-after.json` — still `supported` |
| `take-screenshot` (composition only, #26) | `webgpu/boot.png` (960×540) | `webgl2/boot.png` (960×540) |
| console: zero errors, zero warnings | `webgpu/listings.json` — 7 boot messages, `consoleErrorsOrWarnings: []`, `logErrorsOrWarnings: []`; `webgpu/console-after.json` — 15 messages, none bad | `webgl2/listings.json` — 7 messages, none bad; `webgl2/console-after.json` — 16 messages, none bad |
| network listing beside the console | `webgpu/listings.json` — 330 requests, `networkNotOk: []` | `webgl2/listings.json` — 327 requests, `networkNotOk: []` |

**WebGL2 motor note.** The first `a204-motor` on the WebGL2 tab ran while
the tab was occluded: Chrome throttles `requestAnimationFrame` for hidden
tabs, so the 180 scheduled ticks barely advanced (`state-after` z unchanged;
the WebGPU tab was exempt because it was already *playing audio* — audible
tabs skip occlusion throttling). The tab was activated
(`/json/activate/<target>`) and the sequence re-run; the recorded
`state-after.json` z of 67.57 is the throttled first script's ticks catching
up plus the second script's 18 m. Player `supported` throughout; no fault.

## The unlock → first notes flow (`?debug=1`, both backends)

`cdp-drive.mjs` output (`webgpu/drive.json`, `webgl2/drive.json`), console
during the drive — identical event flow on both backends:

```
[a204] {"event":"music","state":"started","bpm":96,"root":50,"scale":"dorian"}
[a204] {"event":"music","state":"note","part":"kick","tick":0}
[a204] {"event":"music","state":"note","part":"hat","tick":0}
[a204] {"event":"music","state":"note","part":"arp","tick":0}
[a204] {"event":"music","state":"note","part":"drone","tick":0}
[a204] {"event":"music","state":"muted"}
[a204] {"event":"music","state":"unmuted"}
```

Readouts (WebGPU; WebGL2 equivalent, in `drive.json`):

| Step | bpm | muted | running | counters (kick/hat/arp/drone) |
|---|---|---|---|---|
| before gesture | 96 | false | false | 0/0/0/0 |
| after `KeyP` gesture | 96 | false | true | 3/7/9/1 |
| `apply({bpm:90})` → `{ok:true, ignored:[]}` | 90 | false | true | unchanged |
| `apply({bogus:1})` → `{ok:true, ignored:["bogus"]}` | 90 | false | true | — |
| after `M` | 90 | **true** | **false** | frozen while muted |
| after `M` again | 90 | false | true | advancing again |

## `?music=0` (suppressed) — `music0/`

`music0/listings.json`: clean boot (6 messages, no errors/warnings, no
failed requests). `music0/drive.json`: after the same `KeyP` gesture,
`running` stays `false`, all counters 0, **no** `music` events — and
`apply({bpm:90})` still returns `{ok:true}` with the readout showing bpm 90,
so the tuning surface works on a silent page (the graph is built). The `M`
press changes nothing (`muted: false`): the toggle is not wired when music
is suppressed.

## Files

```
README.md            this file
cdp-collect.mjs      #57's collector, unchanged
cdp-console.mjs      #68's console dump, unchanged
cdp-drive.mjs        new: gesture → apply → mute drive, readouts + console
webgpu/              listings.json, console-after.json, system-stats.json,
                     state-before.json, motor.json, state-after.json,
                     drive.json, boot.png
webgl2/              the same eight files for the WebGL2 page
music0/              listings.json, drive.json for ?debug=1&music=0&bridge=0
```
