# Striker plan format version 1

A Striker plan is a directory with these files:

```text
plan.json
spine.md
map.md
log.md
<ordered task files declared by plan.json>
```

This file is the authority for generated plan artifacts. Do not duplicate or
change its manifest and task syntax elsewhere.

## Planning context

Write `spine.md` so an implementor can distinguish approved intent from current
repository evidence. Record:

- the goal and approved observable behavior;
- the evidence state, classified as established, sparse, or blank, and the
  repository scope inspected;
- the intent source, either the concrete developer request or the approved
  product brief;
- each user decision and its reasoning;
- code-backed assumptions in a numbered `A<n>` ledger, with file and line
  citations and the fact each citation establishes;
- local defaults in a numbered `D<n>` ledger, with their reasons and the cost of
  reversing them;
- quality constraints;
- out-of-scope work;
- the full use-case tree, including excluded branches, with branches covered by
  emitted tasks clearly marked.

Do not turn user decisions into assumptions. Do not invent code citations for a
blank area. Preserve uncertainty and contradictions that the implementor may
need to reconcile.

Write `map.md` as a traversal guide. Record:

- existing traversal through relevant entry points, modules, ports, adapters,
  data, and tests;
- planned traversal, clearly marked `unverified` wherever code does not exist
  yet;
- paths shared by multiple tasks;
- paths considered and ruled out, with the evidence that eliminated each one.

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

Each task is one vertical, committable change. Mechanical prerequisites may be a
separate earlier task only when they form a complete green boundary. Use exactly
this heading shape:

````markdown
# Short task title

## Build

State the observable behavior and boundaries.

## Paths

- List files expected to change or be created.

## Test contract

- Name the agreed public seams and behavior each test proves.
- Name the allowed fake system boundary, or state that no fake is allowed.

## Verify

```sh
one deterministic shell command
```
````

The `Verify` block runs later from the Git root. Make it strong enough to prove
the task without requiring an installed or authenticated agent harness unless
the developer explicitly approved a real-harness check.

Split tasks so each one leaves the repository green and gives the next task a
stable public boundary. Keep deferred behavior out of earlier tasks even when
nearby code makes it tempting to add.
