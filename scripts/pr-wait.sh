#!/usr/bin/env bash
# Wait until a PR's verify check has completed and Codex has reviewed the
# current head, then print the verdict and that head's findings. The main
# session runs it as a background command, one per head (CLAUDE.md, the
# main session, "Waiting").
#
# Codex reports a finished review in one of two places: its summary
# comment, whose table names the head by a 7-character SHA beside
# "Completed", or a separate "Reviewed commit: `<10-character SHA>`"
# comment while the summary still says "Running". Both start with the
# head's first 7 characters. A finding belongs to the head when its
# original_commit_id is the head: GitHub moves an older comment's commit_id
# forward when its line still applies.
#
# Usage: bash scripts/pr-wait.sh <N>
set -u
N=$1
R=repos/tacowars/windsor
POLL_SECONDS=300
while :; do
  STATE=$(gh pr view "$N" --json state --jq .state 2>/dev/null)
  if [ "$STATE" != "OPEN" ]; then echo "PR #$N is $STATE"; exit 0; fi
  HEAD=$(gh pr view "$N" --json headRefOid --jq .headRefOid 2>/dev/null)
  SHORT=${HEAD:0:7}
  VERIFY=$(gh pr view "$N" --json statusCheckRollup --jq '[.statusCheckRollup[]|select(.name=="verify")][0]|"\(.status)/\(.conclusion)"' 2>/dev/null)
  CODEX=$(gh api "$R/issues/$N/comments" --paginate --jq '.[]|select(.user.login|test("codex";"i"))|.body' 2>/dev/null |
    grep -F "\`$SHORT" | grep -c -i -E 'completed|reviewed commit')
  if [[ "$VERIFY" == COMPLETED/* ]] && [ "${CODEX:-0}" -gt 0 ]; then
    echo "PR #$N head $SHORT verify=$VERIFY codex=reviewed"
    echo "-- Codex inline findings on this head:"
    gh api "$R/pulls/$N/comments" --paginate --jq ".[]|select(.original_commit_id==\"$HEAD\")|\"\(.path):\(.line // .original_line) \(.body[0:400])\""
    echo "-- reactions:"
    gh api "$R/issues/$N/reactions" --jq '.[]|"\(.user.login) \(.content)"'
    exit 0
  fi
  sleep "$POLL_SECONDS"
done
