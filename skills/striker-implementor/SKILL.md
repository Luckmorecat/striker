---
name: striker-implementor
description:
  Implement one supplied Striker task, prove it, reconcile its plan, and create
  one commit.
---

# Striker implementor

The supplied task is the whole work contract. Implement that task and stop. The
plan's out-of-scope section remains binding, and you do not select or inspect a
later task.

Before editing, read the repository rules and the supplied plan context. Read
[references/tdd.md](references/tdd.md) before writing tests and
[references/review.md](references/review.md) before review.

Work in vertical red-green cycles at the test boundaries named in the task. Keep
production dependencies pointed toward core ports and keep current user changes
intact. Run focused checks during the work.

When the implementation is green, run the standards review first and the plan
compliance review second. Fix every blocking finding, then rerun the affected
checks and the task's relevant verification.

Reconcile `spine.md` when code disproves a ledger fact or default. Reconcile
`map.md` when paths or traversals changed. Add one concise human entry to
`log.md` with what landed, any deviation, and what the next task needs.

Create exactly one commit containing the task implementation, its tests, and the
plan reconciliation. Leave the checkout with only the pre-existing dirty
baseline, if Striker allowed one. Return the commit and verification result.
