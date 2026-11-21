#!/bin/sh
# Stop hook: after an agent turn, commit any spec task that was just ticked off.
# Works whether tasks are started from the task list or pushed along in chat.
msg=""
for spec in .kiro/specs/*/tasks.md; do
  name=$(basename "$(dirname "$spec")")
  done_now=$(git diff -U0 HEAD -- "$spec" | sed -n "s/^+- \\[x\\] \\([0-9][0-9]*\\)\\. \\(.*\\)\$/$name task \\1: \\2/p")
  [ -n "$done_now" ] && msg="${msg:+$msg; }$(echo "$done_now" | paste -sd ';' - | sed 's/;/; /g')"
done
[ -n "$msg" ] || exit 0
tests=$(npx --no-install vitest run 2>&1 | sed -n 's/^ *Tests *//p' | head -1)
git add -A
git commit -q -m "$msg" -m "Committed by the Kiro Stop hook when the task was ticked off. Tests: ${tests:-not run}"
