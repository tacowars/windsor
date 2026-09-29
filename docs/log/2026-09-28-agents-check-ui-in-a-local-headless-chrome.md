# Agents check their UI in a local headless Chrome

- **Date:** 2026-09-28
- **Status:** accepted (tacowars, windsor#58)

## Context

No agent could look at the app it had changed. The first parallel wave put
that down to the sandbox: a dev server started by an agent never loaded in
Claude in Chrome, so worker PRs listed manual checks and waited for tacowars's
look at the preview.

The sandbox was not the cause. A dev server started from an agent's shell
listens on this machine's `127.0.0.1` and answers `curl`, and tacowars's own
Chrome here opens it. The Claude in Chrome extension connected to tacowars's
account runs on the other Mac, so its `localhost` is that machine. Public
URLs, such as the PR previews, worked, which hid the cause.

HOOP and Aotearoa204 never met this. Both register the Chrome DevTools MCP
server in `.mcp.json`. Claude Code starts that server, and its Chrome, on
the machine it runs on.

## Decision

**Register `chrome-devtools-mcp` in `.mcp.json`, headless and isolated.**

- **Headless and isolated.** The Chrome opens no window and starts from a
  temporary profile, so an agent never sees tacowars's own browser data, and
  each server start begins with empty IndexedDB.
- **Pinned.** The version is pinned (1.10.1) rather than `@latest`, so a
  new release can't change what agents run without a PR.
- **No telemetry.** `--no-usage-statistics` and `--no-performance-crux`
  stop the server sending usage data to Google and trace URLs to the CrUX
  API.
- **Workers share one browser.** The server is one per session, and
  sub-agents use it too. Each worker serves on its own port
  (`5200 + N % 100`), which also gives it its own origin and storage, and
  acts only on the page it opened. HOOP measured two hazards, and the
  worker rules carry both: `get_network_request` can hang on a response
  body that never completes and block every other call, and one agent can
  close another's page. The rules are in `.claude/worker-rules.md`.
- **The preview stays tacowars's look.** A worker's own check catches layout
  and wiring before review; it doesn't replace tacowars's look at a UI PR.

## Provenance

`chrome-devtools-mcp` is Google's Chrome DevTools MCP server
(<https://github.com/ChromeDevTools/chrome-devtools-mcp>), Apache-2.0,
which is AGPL-3.0-compatible. It is a development tool run through `npx`,
not a dependency of the app, and nothing from it ships in `dist/`.

## Consequences

- The first session after this merges asks to enable the project's MCP
  server. `enableAllProjectMcpServers` is off in tacowars's user settings, so they
  approve it once, or lists it in `.claude/settings.local.json` under
  `enabledMcpjsonServers` as HOOP and Aotearoa204 do.
- The server needs Google Chrome installed on the machine running Claude
  Code.
