# Worker rules

What workers have tripped on. The protocol itself is `CLAUDE.md`
"Working a ticket"; this file only adds to it.

- **Worktree packages.** Link the worktree's own packages before any test
  or typecheck, or `@windsor/*` resolves to the main checkout:
  `mkdir -p node_modules/@windsor && ln -sfn ../../packages/engine node_modules/@windsor/engine && ln -sfn ../../packages/app node_modules/@windsor/app`
- **Node.** The project needs the Node major in `.nvmrc` (24). The machine
  default may be older, so use that one. Don't run `npm ci` unless a test
  can't run otherwise.
- **Labels.** `gh pr edit` fails on this repo. Add a label with
  `gh api repos/tacowars/windsor/issues/<N>/labels -f 'labels[]=<label>'`.
- **Browser.** A UI change is looked at before the PR opens, in the
  project's headless Chrome (the `mcp__chrome-devtools__*` tools,
  registered in `.mcp.json`). Never use Claude in Chrome: it runs on
  another machine and can't reach this one's `localhost`.
  - Serve the worktree on your own port, `5200 + N % 100` for issue N:
    `npm run dev -w packages/app -- --port <port> --host 127.0.0.1`, as a
    `run_in_background` Bash call with no trailing `&`.
  - Open your own page with `new_page` and pass its `pageId` to every
    call. Never act on a page you didn't open; the browser is shared with
    the main session and the other worker.
  - To set up a song, import JSON rather than clicking it together: on
    the Settings tab (`[data-tab="arrangement"]`), put a `File` in
    `input[name="import-file"]` through a `DataTransfer` and dispatch
    `change`. A part's cards show in the Song tab's pane once one of its
    regions is selected. After a reload, accept the "Restore" prompt.
  - Check what the issue's acceptance criteria describe: one
    `evaluate_script` per step, returning the few values you need, and a
    screenshot for layout, which DOM text can't show.
  - Don't call `get_network_request` (it can hang the shared browser). If
    a call gets no response, don't retry it; report what you checked.
  - When done, `close_page` your page and stop your server with TaskStop.
  - List what you checked in the PR. tacowars still looks at the preview.
- **CI and the final message.** As `CLAUDE.md` steps 4 and 5 say; the hook
  denies CI polling, so don't retry it.
- **Fix round.** Fix on the same branch, push, update the PR body, and
  comment `@codex review`.
