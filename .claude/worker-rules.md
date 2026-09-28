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
- **Browser.** The sandbox can't reach a dev server, so don't try. List
  the manual checks in the PR; a preview link is commented automatically.
- **CI and the final message.** As `CLAUDE.md` steps 4 and 5 say; the hook
  denies CI polling, so don't retry it.
- **Fix round.** Fix on the same branch, push, update the PR body, and
  comment `@codex review`.
