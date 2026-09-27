# Browser verification — #75 arrangement document layer

- Machine: Apple M4 Pro (macOS), development machine — **indicative only**,
  not the target box (no frame-budget criterion on this ticket; nothing here
  is a milestone measurement).
- Chrome: via the chrome-devtools MCP (`new_page`); the MCP-native path
  worked first try — the stale Chrome holding the MCP profile had been
  killed beforehand, so no CDP substitute was needed.
- Branch/commit: `feature/75-arrangement-document` @ `0c4cb39` (the page's
  `gitCommit` readout matches).
- Backends exercised: **WebGPU** (default) and **WebGL2**
  (`&backend=webgl2`), each against the inspector CLI bridge
  (`npx babylon-inspector`), daemon started before the pages.

## Files

| File | What it proves |
|---|---|
| `webgpu-system-stats.json` / `webgl2-system-stats.json` | Backend + hardware driver (`WebGPU1` on Apple Metal 3; `ANGLE Metal Renderer: Apple M4 Pro`) — real GPU, not SwiftShader |
| `webgpu-state-start.json` / `webgpu-state-after-move.json` | `query-a204-state` before and after `a204-motor {"x":0,"z":6,"seconds":3}`: z 32.03 → 49.83 (+17.8 m at 6 m/s) |
| `webgl2-state-start.json` / `webgl2-state-after-move.json` | Same scripted move on WebGL2 — final position bit-identical to WebGPU's |
| `webgpu-screenshot.png` / `webgl2-screenshot.png` | Composition evidence (offscreen render-target capture; backend proof is the system stats, never the PNG — #26) |
| `webgpu-console-and-network.md` / `webgl2-console-and-network.md` | Full console listings (zero errors, zero warnings; the one extra post-screenshot line is the documented `DumpTools` encoder banner) paired with the network listings (all 200/304) |

## Ticket-specific evidence (the arrangement document layer)

On both backends the `music` console events show the game playing **from the
committed JSON document**: `{"state":"started","bpm":96,"root":50,"scale":"dorian"}`
followed by a first-note event for each of kick, hat, arp, drone — and **no**
`arrangement` corrections event, i.e. `arrangements/bed-01.json` normalised
with zero corrections in the running game. The network listings show
`GET /src/audio/arrangements/bed-01.json?import` (Vite's build-time module
import) and no runtime fetch.

On WebGL2, `__a204.audio.apply({ mix: { hat: { level: 0.3, sends: { echo:
0.4 } } }, wat: 1 })` returned `{ ok: true, ignored: ["wat"] }` with the
transport still running and all four note counters advancing — the
generalised document-model apply working live.
