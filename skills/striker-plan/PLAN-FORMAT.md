# Striker plan format version 1

A Striker plan is the executable package for one approved specification.

Store it at:

`.striker/plans/<slug>/<spec-hash-prefix>/`

Use the specification slug and the first 12 hexadecimal characters of the
SHA-256 of the exact approved specification bytes.

A plan directory contains:

```text
plan.json
spine.md
map.md
log.md
<ordered task files declared by plan.json>
```

The source brief and specification remain outside the plan directory.

This file is the authority for plan serialization. Do not duplicate its
manifest or task syntax elsewhere.

## Planning context

Write `spine.md` with:

- the approved specification path and full SHA-256;
- a verbatim snapshot of the approved specification;
- the evidence state, classified as established, sparse, or blank;
- the repository scopes inspected;
- each user implementation decision and its reasoning;
- code-backed assumptions in an `A<n>` ledger, with file and line citations;
- local defaults in a `D<n>` ledger, with reasons and reversal costs;
- the complete requirement-to-task mapping;
- the use-case tree, including excluded branches and task coverage.

The specification snapshot is immutable. Implementation may reconcile disproved
`A<n>` and `D<n>` entries, but must not change approved intent. A change to
approved intent requires a revised specification and a new plan hash.

Do not turn user decisions into assumptions or invent citations for a blank
area.

Write `map.md` as a traversal guide containing:

- current traversal through relevant entry points, modules, ports, adapters,
  data, and tests;
- planned traversal, marked `unverified` where code does not yet exist;
- paths shared by several tasks;
- paths considered and ruled out, with the evidence that ruled them out.

Use repository-relative paths. A planned path is not evidence of current
behavior.

Write `log.md` with only a short instruction to append one entry per completed
task. It contains no implementation entries when the plan is created.

## Manifest

Write `plan.json` in this shape and keep task paths in dispatch order:

```json
{
  "$schema": "./node_modules/@kisshot/striker/plan.schema.json",
  "version": 1,
  "taskSource": "striker-plan",
  "tasks": ["01-first-task.md", "02-second-task.md"]
}
```

Task paths are unique, normalized relative POSIX paths. Every Markdown file in
the directory other than `spine.md`, `map.md`, and `log.md` must appear in the
manifest.

## Task files

Each task is one vertical, committable change. Every in-scope requirement maps
to at least one task, and every task lists at least one approved requirement.

Use exactly:

````markdown
# Short task title

## Build

Requirements: R1, R2

State the observable behavior and boundaries.

## Paths

- List files expected to change or be created.

## Test contract

- Name the public seams and behavior each test proves.
- Name the allowed fake system boundary, or state that no fake is allowed.

## Verify

```sh
one deterministic shell command
```
````

The `Verify` block runs from the Git root. It must prove the task without
requiring an installed or authenticated agent runtime unless the developer
approved a real-runtime check.

A mechanical prerequisite may be a separate earlier task only when it has its
own complete green boundary. Each task leaves the repository green and gives
the next task a stable public boundary.
