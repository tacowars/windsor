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
  `code=false`, no artifact is built, and `preview` is skipped.

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
