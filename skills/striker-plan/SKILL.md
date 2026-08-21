---
name: striker-plan
description:
  Use only when the developer explicitly invokes $striker-plan to create a
  versioned Striker implementation plan.
metadata:
  opencode/autoinvoke: "false"
---

# Striker plan

Proceed only when the developer explicitly invoked `$striker-plan`.

Create a Striker plan from an approved implementation goal.

1. Inspect the repository before claiming current behavior. Ask only about
   choices that code and existing decisions cannot answer.
2. Agree the public test seams and meaningful test boundaries with the user.
3. Read [PLAN-FORMAT.md](PLAN-FORMAT.md), then write the manifest, planning
   context, ordered tasks, and empty log it specifies.
4. Run the target project's `node_modules/.bin/striker plan validate <source>`.
   Correct the plan until validation passes.

Finish by naming the plan directory and the agreed test seams.
