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

Treat every supplied plan file as read-only. Keep implementation discoveries in
the final report so Striker can review and record them outside the immutable
plan.

Create exactly one commit containing only the implementation and tests. Preserve
any allowed pre-existing dirty baseline.

After reviews and checks pass, emit the machine-readable review evidence
requested by Striker. Then report the commit and verification result.
