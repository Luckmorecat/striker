---
name: striker-implementor
description: Internal workflow for implementing one supplied Striker task.
---

# Striker implementor

Implement only the supplied task. Use the plan context for shared intent and
exclusions. Leave later tasks unopened.

Before editing, read the repository rules and supplied plan context. Read
[references/tdd.md](references/tdd.md) before writing tests and
[references/review.md](references/review.md) before review.

Work in vertical red-green cycles through the test boundaries named in the task.
Follow the repository rules, preserve current user changes, and run focused
checks during the work.

When implementation is green, run the standards review and then plan compliance
review. Fix every blocking finding and rerun affected checks and task
verification.

Update the local plan files before completion. Reconcile the `A<n>` and `D<n>`
ledgers in `spine.md` when code disproves them, but never alter the immutable
intent snapshot. Reconcile `map.md` when paths or traversals change. Add one
concise entry to `log.md` covering what landed, any deviation, and what the next
task needs.

Create exactly one commit containing only the implementation and tests. Leave
`.striker/` reconciliation local and uncommitted. Preserve any allowed
pre-existing dirty baseline.

After reviews and checks pass, emit the machine-readable review evidence
requested by Striker. Then report the commit and verification result.
