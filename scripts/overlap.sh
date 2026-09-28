#!/usr/bin/env bash
# Before launching a worker, show what in-flight work touches the paths a
# ticket owns, and which of those paths are hotspots that should be
# sequenced or pre-registered by a seam ticket. Read-only.
#
#   bash scripts/overlap.sh packages/engine/src/harmony packages/app/src/songView.ts
#
# Sources: every open PR's changed files, and every local worktree branch's
# diff against origin/main. Exit 1 when an overlap or a hotspot is found,
# so the main session cannot miss it.

set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/overlap.sh <path-or-prefix>..." >&2
  exit 2
fi

# Files a wave shares. An append here by two tickets is a rebase round.
hotspots=(
  packages/engine/src/index.ts
  packages/engine/src/song/partGenerators.ts
  packages/engine/src/inserts/insertRegistry.ts
  packages/engine/src/inserts/meteredInsertRegistry.ts
  packages/engine/src/inserts/tempoInsertRegistry.ts
  packages/engine/src/patches/index.ts
  packages/app/src/main.ts
  package.json
  package-lock.json
)

git fetch -q origin main

matches() { # $1 = label, stdin = changed files
  local label="$1" file hit=0
  while IFS= read -r file; do
    for want in "${wanted[@]}"; do
      case "$file" in
        "$want" | "$want"/*) echo "  $label touches $file"; hit=1 ;;
      esac
    done
  done
  return $hit
}

wanted=("$@")
status=0

echo "== open pull requests"
while IFS=$'\t' read -r number branch title; do
  [ -z "$number" ] && continue
  if ! gh pr diff "$number" --name-only | matches "PR #$number ($branch)"; then status=1; fi
done < <(gh pr list --state open --json number,headRefName,title \
  --jq '.[] | [.number, .headRefName, .title] | @tsv')

echo "== local worktree branches"
while IFS= read -r branch; do
  [ -z "$branch" ] || [ "$branch" = "main" ] && continue
  if ! git diff --name-only "origin/main...$branch" 2>/dev/null | matches "branch $branch"; then status=1; fi
done < <(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')

echo "== hotspots among the requested paths"
for want in "${wanted[@]}"; do
  for hot in "${hotspots[@]}"; do
    case "$hot" in
      "$want" | "$want"/*) echo "  $hot: sequence this ticket, or pre-register in a seam ticket"; status=1 ;;
    esac
  done
done

if [ "$status" -eq 0 ]; then echo "no overlap, no hotspot"; fi
exit "$status"
