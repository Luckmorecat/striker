# Striker plan format version 1

A Striker plan is a directory with these files:

```text
plan.json
spine.md
map.md
log.md
<ordered task files declared by plan.json>
```

`spine.md` records the goal, approved behavior, current code evidence, defaults,
quality constraints, out-of-scope work, and a use-case tree. `map.md` records
paths and traversals that help an implementor enter the code. `log.md` starts
with a short instruction to append one entry per completed task.

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

Each task is one vertical, committable change. Use exactly this heading shape:

````markdown
# Short task title

## Build

State the observable behavior and boundaries.

## Paths

- List files expected to change or be created.

## Test contract

- Name the agreed public seams and behavior each test proves.

## Verify

```sh
one deterministic shell command
```
````

The `Verify` block runs later from the Git root. Make it strong enough to prove
the task without requiring an installed or authenticated agent harness unless
the user explicitly approved a real-harness check.

Split tasks where each one leaves the repository green and gives the next task a
stable public boundary. Keep deferred behavior out of earlier tasks even when
nearby code makes it tempting to add.
