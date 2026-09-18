# A conflict on the generated console page is resolved by regenerating it

- Date: 2026-09-18
- Area: devx
- Links: issue #628 · epic #622 · record `2026-09-18-patch-editor-page-is-checked-not-trusted`

## Decision

`.gitattributes` names a custom merge driver on
`tools/patch-editor/patch-editor.html` and `scripts/dev-bootstrap.sh`
registers it (`merge.regenerate-console-page.name` / `.driver`, no
`--worktree`, so the shared repository config serves the main checkout and
every worktree `ticket-start.sh` adds). The driver,
`scripts/git-merge-regenerate-console-page.sh`, runs `git merge-file` on the
three versions git hands it and keeps a clean text merge; only when that
conflicts does it rebuild the page with `node
tools/patch-editor/build-editor.mjs` and copy the result over `%A`, and a
build that fails exits non-zero so git leaves the path conflicted instead of
silently taking a side. The page is generated, so the merge of its text is
never the question worth asking — `build-editor.mjs --check` inside `npm run
verify` remains the only statement about whether the tracked page matches its
sources, and it is what makes an automatic resolution safe.

## Why

Every console ticket rebuilds and commits the page, so two console PRs in
flight together can conflict on 1.2 MB of generated text whose resolution is
always the same mechanical step: take a side, run the build, commit. The
driver is that step. Two facts from the reproductions shaped its shape, and
neither was visible when the ticket was written. First, git computes content
merges **before** it updates the working tree, and a merge driver is invoked
only when both sides changed the file — so the sources this driver can read
are the pre-merge ("ours") ones, exactly the ones that do not contain the
other side's change. A regenerated page is therefore always one merge step
behind, and no merge driver can do better. Second, the page's generated text
usually merges correctly on its own: two branches that relabelled different
console sources produced disjoint line edits, git's text merge combined them,
and `--check` passed on the result byte for byte. Regenerating
unconditionally, as the ticket's design point 2 said, would have replaced that
correct page with a stale one — a net loss on precisely the disjoint-source
case the ticket exists for. Keeping the clean text merge and regenerating only
on a conflict is therefore weakly better than both baselines: nothing that
merges today stops merging, a page conflict resolves without a human, and a
page that is wrong either way is caught by the same `--check`.

## Punted / alternatives

Making the merged page *correct* would need the merged sources, which no merge
driver has; the complements that would are a `post-merge` / `post-rewrite`
hook rebuilding the page once the tree has settled, or simply not tracking the
page — both were out of this ticket's scope, and both are only worth it if the
one-command rebuild after a conflicted merge proves to be a real cost. Nothing
was done for GitHub's merge preview or for CI, which never run custom drivers:
an unregistered driver name falls back to git's text merge (verified with both
config keys removed), which is what those environments do today. A checkout
that has `merge.regenerate-console-page.name` without `.driver` is the one bad
state — git refuses the merge with `fatal: custom merge driver
regenerate-console-page lacks command line` — so `dev-bootstrap.sh` writes
both keys together and is idempotent.
