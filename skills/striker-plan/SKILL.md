---
name: striker-plan
description: Create a validated Striker plan from an approved specification.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Striker plan

Create the executable implementation plan for one approved specification. Shape
and Spec own product direction and observable behavior.

## Verify the specification

Read
[SPEC-FORMAT.md](../striker-preparation/SPEC-FORMAT.md)
and verify the supplied specification in full.

Accept only an approved specification. A request, brief, existing plan, or old
`spine.md` is not an intent source for Plan. When the specification is missing,
stop and print:

```text
Next: $striker-spec <approved-brief-or-shaped-request>
```

`$striker-spec` may use an old `spine.md` as unapproved recovery input.

The specification controls desired behavior. Repository code describes current
behavior.

## Discover the implementation

Classify the relevant area as established when nearby precedents answer most
choices, sparse when important gaps remain, or blank when no relevant
implementation, build configuration, or tests exist.

Inspect the feature area, its parent, and then the wider repository. For each
choice that can block implementation:

1. Search those scopes for the nearest precedent.
2. Record a clear precedent as an `A<n>` assumption with a file and line
   citation.
3. Use a `D<n>` default only for a local choice reversible within one task.
4. Ask about hard-to-reverse implementation choices that remain within the
   approved specification.

Enumerate the choices before asking questions. Resolve blocking choices first
and batch only independent questions.

If a choice can change an approved requirement, public contract, data or
security decision, or compatibility or deployment constraint, stop and print:

```text
Next: $striker-spec <specification-path>
```

For a blank area, read [BOOTSTRAP.md](BOOTSTRAP.md).

Treat differences between the specification and code as implementation work.
Ask for clarification only when repository evidence makes an approved
requirement ambiguous, inconsistent, or infeasible.

## Design vertical tasks

Use the specification's successful, variant, failure, and boundary cases as the
use-case tree. Preserve excluded branches and mark task coverage.

Map requirements to tasks in both directions. Build an ordered sequence of
tracer-bullet tasks. Each task must deliver an observable, independently green
result, fit one fresh agent context, and define:

- concrete repository-relative paths;
- a public test seam and the behavior it proves;
- the allowed system fake, if any;
- one deterministic verification command.

Use a separate mechanical prerequisite only when it has its own complete green
boundary.

For an unavoidable wide change, expand first, migrate callers in green batches,
then contract by removing the old form. Keep Striker's strict dispatch order.
Do not create an external tracker or separate dependency graph.

## Review and approve

Before presenting the plan, check:

- requirement coverage in both directions;
- task granularity and order;
- paths and shared-file sequencing;
- test seams and fake boundaries;
- verification commands.

Fix every gap found.

Present the specification path and SHA-256, scope, exclusions, decisions,
assumptions, defaults, requirement mapping, ordered tasks, and test contracts.

Obtain explicit approval of the task boundaries and test contracts. Apply
requested changes and present the changed preview again. Write no plan artifacts
before approval.

## Write and validate the plan

After unambiguous approval, read [PLAN-FORMAT.md](PLAN-FORMAT.md) and write the
plan in its required location. Serialize requirement traceability as that format
requires.

If the target directory exists, show it and obtain approval before replacing any
file.

Validate the plan with:

```sh
node_modules/.bin/striker plan validate <plan-directory>
```

Stop if the project-local binary is absent. Correct every failure and rerun
validation until it passes.

Print:

```text
Validated plan: <plan-directory>
Next: $striker run <plan-directory>
```

Stop without invoking Striker.
