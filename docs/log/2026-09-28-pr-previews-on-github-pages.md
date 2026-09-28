# Every PR gets a preview on GitHub Pages

- **Date:** 2026-09-28
- **Status:** accepted (Pat's decisions in windsor#37)

## Context

A PR was reviewed from its diff and a local `npm run dev`. A UI change
needs to be seen and played, and Pat reviews from his desk and his phone.
He wanted a live URL on every PR, one click from the PR page.

The site was deployed with GitHub's Actions Pages flow
(`upload-pages-artifact` then `deploy-pages`). That flow publishes one
artifact as the whole site, so it has no room for a second build beside
main's.

## Decision

**Stay on GitHub Pages, served from a `gh-pages` branch.**

- **main's build goes to the branch root.** The site stays at
  <https://tacowars.github.io/windsor/>.
- **Each PR's build goes to `pr-preview/pr-<N>/`.** Its URL is
  `https://tacowars.github.io/windsor/pr-preview/pr-<N>/`.
- **No rebuild per path.** `packages/app/vite.config.ts` builds with a
  relative `base` (`./`). The entry chunk, the lazily loaded presets chunk
  and each worklet (named with `new URL(…, import.meta.url)`) resolve
  against the page or the module that loads them, so one `dist/` serves
  from the root and from any subfolder.
- **Tooling.** `rossjrw/pr-preview-action` deploys a PR's preview on open,
  reopen and push, removes it on close or merge, and keeps one sticky
  comment with the URL. main's deploy uses
  `JamesIves/github-pages-deploy-action` with `clean-exclude: pr-preview/`,
  so it replaces the root without deleting open previews, and with
  `force: false`, so it rebases onto a concurrent preview push rather than
  overwriting it. Every third-party action is pinned to a full commit SHA
  with a version comment. The comment's QR code is off: it would send each
  preview URL to a third-party QR service.
- **`.nojekyll` at the root.** Pages runs Jekyll over a branch source, which
  drops files whose names start with `_`. main's deploy writes the marker.

### Three writers on one branch

`deploy`, `preview` and `preview-remove` all push to `gh-pages`. One shared
concurrency group would serialise them, but a group holds only one pending
run, and a newer one cancels it even with `cancel-in-progress: false`. A
burst of PR pushes could then drop main's deploy, or another PR's preview.
So the design scopes the groups and relies on a retrying push:

- **Groups scoped to content.** main's deploy is in `gh-pages-main`, and a
  PR's preview and removal are in `gh-pages-pr-<N>`. A pending run is
  superseded only by a newer run for the same content: a newer main build,
  or a newer event on the same PR. main is linear, so the newer build
  already holds whatever the superseded one would have published.
- **A retrying push across groups.** Writers in different groups can push
  at once. Every writer uses the deploy action with `force: false`. Its
  documented behaviour in both pinned versions, and in the code of v4.9.0
  (ours) and v4.7.4 (inside pr-preview-action v1.8.1), is the same. A push
  the remote rejects is followed by a fetch of the branch, a rebase onto
  it, and another push, up to `attempt-limit` times: 3 by default, 5 for
  main's deploy. Past the limit the job fails and is not silently dropped.
- **The rebase cannot conflict.** main writes the root with
  `clean-exclude: pr-preview/`, and a preview writes only
  `pr-preview/pr-<N>/`, so no two writers touch the same file.

### The security boundary

`verify` is the only job that checks out and runs the PR's code, and its
token stays `contents: read`. It uploads `packages/app/dist` as a workflow
artifact, on PRs and on main.

The jobs that hold a write token (`deploy` with `contents: write`;
`preview` and `preview-remove` with `contents: write` and
`pull-requests: write`) never check out or run the PR's code. They download
the artifact and push files. The deploy action needs a git repository in
the workspace, so each seeds an empty one.

- **Previews run only for PRs from this repo**
  (`head.repo.full_name == github.repository`). A fork PR runs `verify`
  alone and gets no write token.
- **A docs-only PR gets no preview.** The `changes` step reports
  `code=false`, no artifact is built, and `preview` is skipped. If an
  earlier push had code and left a preview, `preview-remove` deletes it in
  the same per-PR group, so no stale build stays linked.
- **Removal is quiet when there is nothing to remove.** `preview-remove`
  first asks the contents API whether `pr-preview/pr-<N>/` exists on
  `gh-pages`, using the job's token and no checkout. If it doesn't, the job
  pushes nothing and posts no "removed" comment. This covers closing a
  docs-only PR and every docs-only push.

## Why not Cloudflare Pages

Cloudflare Pages gives previews out of the box. It needs a new account and
an API token stored as a repo secret, which a workflow on PR events would
have to be trusted with. GitHub Pages needs neither: `GITHUB_TOKEN` scoped
per job is enough.

## Consequences

- **The Pages source is a repo setting.** It moves from "GitHub Actions" to
  "Deploy from a branch", `gh-pages`, root. Until it does, the branch is
  written but not served, and the live site keeps its last Actions
  deployment.
- **A preview is public.** Anyone with the URL can open it, like the live
  site.
- **`gh-pages` keeps history.** Each deploy is a commit. The branch is
  build output and can be squashed or recreated at any time.
- **A UI PR's reviewer opens the preview** from the PR comment
  (`CLAUDE.md`, "Working a ticket").
