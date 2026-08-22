---
name: striker-shape
description: Create or revise an approved Striker brief for an open product decision.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Striker shape

Create or revise one approved brief when product direction remains open. Stop
before specification or implementation planning.

## Inspect the idea

Resolve the target Git root. Inspect the request, any existing brief, and nearby
repository evidence.

Track unresolved shaping decisions: outcome, direction, scope, constraints,
exclusions, feasibility, cost, alternatives, and hard-to-reverse tradeoffs.
Record contradictions separately and remove anything settled by evidence.

The developer controls product intent. Repository code describes current
behavior.

After initial inspection, delegate only a bounded independent sweep that saves
substantial time or context. Verify its citations yourself and retain ownership
of all decisions and the brief.

## Resolve the direction

Ask only about unresolved shaping decisions. Resolve blockers first and batch
only independent questions.

Leave detailed behavior, edge cases, contracts, and acceptance conditions for
`$striker-spec`.

Present material alternatives with concrete tradeoffs. Separate developer
choices, repository evidence, and assumptions. Let the developer choose the
direction.

## Approve the brief

Read
[BRIEF-FORMAT.md](../striker-preparation/BRIEF-FORMAT.md)
and draft one brief. Summarize the decisions rather than the conversation.

Ask:

> Approve this brief as written?

Apply requested changes and ask again. After unambiguous approval, write:

`.striker/briefs/<slug>.md`

Reuse an existing slug only when revising that brief. Edit `.gitignore` only
with separate authorization.

Print:

```text
Approved brief: .striker/briefs/<slug>.md
Next: $striker-spec .striker/briefs/<slug>.md
```

Stop without invoking the next skill.
