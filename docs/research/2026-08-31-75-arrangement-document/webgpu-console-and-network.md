# WebGPU page — console and network evidence (#75)

Page: `http://localhost:5173/?debug=1` via chrome-devtools MCP `new_page`
(MCP-native path worked first try; no CDP substitute needed — the stale
Chrome that held the profile had been killed beforehand).

## Console (final listing, after screenshot) — zero errors, zero warnings

```
msgid=1  [debug] [vite] connecting...
msgid=2  [debug] [vite] connected.
msgid=3  [log] BJS - [22:59:27]: Babylon.js v9.23.0 - WebGPU1 engine
msgid=4  [info] [a204] {"event":"engine","backend":"WebGPU","gpu":"apple metal-3 unknown version"}
msgid=5  [info] [a204] {"event":"debug","shim":true,"bridge":true}
msgid=6  [info] [a204] {"event":"bridge","name":"Aotearoa204 WebGPU","port":4400,"connected":true}
msgid=7  [info] [a204] {"event":"chunks","built":1736,"disposed":0,"queued":51,"ms":501}
msgid=8  [info] [a204] {"event":"chunks","built":51,"disposed":0,"queued":0,"ms":17}
msgid=9  [info] [a204] {"event":"music","state":"started","bpm":96,"root":50,"scale":"dorian"}
msgid=10 [info] [a204] {"event":"music","state":"note","part":"kick","tick":0}
msgid=11 [info] [a204] {"event":"music","state":"note","part":"hat","tick":0}
msgid=12 [info] [a204] {"event":"music","state":"note","part":"arp","tick":0}
msgid=13 [info] [a204] {"event":"music","state":"note","part":"drone","tick":0}
msgid=14 [log] BJS - [23:00:36]: Babylon.js v9.23.0 - WebGL2 - Parallel shader compilation
```

- msgid=9: the transport started from the **JSON document** (bpm 96, root 50,
  dorian — the committed `arrangements/bed-01.json`), no `arrangement`
  corrections event, i.e. the committed document normalised with zero
  corrections in the running game.
- msgid=10–13: all four parts announce their first note.
- msgid=14 is the known non-fault: the `DumpTools` PNG **encoder** engine
  banner at the first `take-screenshot` (browser-testing §5, #26), not a
  stray engine.

## Network (`list_network_requests`, paired per §7)

337 requests, every one `200` or `304` — no failures, no 404s. Notable:

```
reqid=163 GET http://localhost:5173/src/audio/arrangements/bed-01.json?import [200]
```

That is Vite's build-time JSON **module import** (dev-server module
transform); there is no runtime `fetch` of any arrangement, and no request
after load beyond the module graph + Havok wasm.
