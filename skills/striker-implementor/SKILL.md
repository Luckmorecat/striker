---
name: striker-implementor
description: Internal workflow for implementing one supplied Striker task.
---

# Striker implementor

Implement only the supplied task. Use the immutable plan context for shared
intent and exclusions. Leave later tasks unopened.

Before editing, read the repository rules and supplied plan context. Read
[references/tdd.md](references/tdd.md) before writing tests.

Work in vertical red-green cycles through the test boundaries named in the task.
Change only task-authorized project paths. Follow the repository rules, preserve
current user changes, and run focused checks during the work.

Treat every supplied plan file as read-only. Keep implementation discoveries in
the final report so Striker can review and record them outside the immutable
plan.

Create exactly one commit containing only the implementation and tests. Preserve
any allowed pre-existing dirty baseline.

After the checks pass, return one strict JSON object and no other text:

```json
{ "kind": "implementation", "summary": "Describe what landed." }
```
