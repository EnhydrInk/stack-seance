#!/bin/sh
# PreTaskExec gate: block the next spec task while the test suite is red.
# Exit 2 blocks the task; Kiro shows stderr to the agent.
[ -f package.json ] || exit 0
out=$(npx --no-install vitest run --passWithNoTests 2>&1) && exit 0
echo "$out" | tail -n 40 >&2
echo "The test suite is red. Fix the failing tests before starting the next task." >&2
exit 2
