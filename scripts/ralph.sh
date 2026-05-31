#!/usr/bin/env bash
#
# Standalone Ralph driver — the raw bash version of Phase 3 from the AFK article,
# for when you want to run the loop outside the defineworkflow engine.
#
# One git worktree + one fresh-context Claude loop per ticket, all in parallel.
# Each iteration: read PROMPT.md, pick the next unchecked task, ship it, commit,
# tick the box. Exit when no "- [ ]" lines remain.
#
# Usage:  scripts/ralph.sh docs/tickets/*.md
#
set -euo pipefail

[ "$#" -ge 1 ] || { echo "usage: $0 <ticket.md> [ticket.md ...]" >&2; exit 1; }

for ticket in "$@"; do
  name="$(basename "$ticket" .md)"
  git worktree add "../wt-$name" -b "feat/$name"
  (
    cd "../wt-$name"
    cp "../$(basename "$(pwd)")/$ticket" PROMPT.md 2>/dev/null || cp "$ticket" PROMPT.md
    while :; do
      cat PROMPT.md | claude --dangerously-skip-permissions
      grep -q "^- \[ \]" PROMPT.md || break   # exit when no unchecked items remain
    done
  ) &
done

wait
echo "All Ralph loops finished. Review the feat/* branches before merging."
