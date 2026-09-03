# Striker plan format version 3

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
- the context behind each typed `A<n>` assumption in `plan.json`;
- the context behind each typed `D<n>` default in `plan.json`;
- the complete requirement-to-task mapping;
- the use-case tree, including excluded branches and task coverage.

The specification snapshot and the rest of the plan package are immutable after
validation. Plan execution records later ledger states outside this directory.
A change to approved intent requires a revised specification and a new plan.

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

## Manifest

Write `plan.json` in this shape and keep task paths in dispatch order:

```json
{
  "$schema": "./node_modules/@useless_mob/striker/plan.schema.json",
  "version": 3,
  "taskSource": "striker-plan",
  "assumptions": {
    "A1": {
      "statement": "The CLI owns command registration.",
      "evidence": [
        { "path": "src/cli.ts", "line": 42 }
      ]
    }
  },
  "defaults": {
    "D1": {
      "statement": "Use the existing command naming pattern.",
      "reason": "Adjacent commands use that pattern.",
      "reversalCost": "Rename one internal option and its tests."
    }
  },
  "outcomeRoutes": [
    {
      "from": "01-first-task.md",
      "to": ["02-second-task.md"]
    }
  ],
  "tasks": ["01-first-task.md", "02-second-task.md"]
}
```

`assumptions` and `defaults` are required objects and may be empty. Assumption
property names match `A[1-9][0-9]*`; default property names match
`D[1-9][0-9]*`. Object keys make IDs unique within each ledger. Every statement,
reason, and reversal cost contains a non-whitespace character. Each assumption
has at least one evidence location. An evidence path is a normalized,
repository-relative POSIX path, and its line is a positive integer.

Task paths are unique, normalized relative POSIX paths. Every Markdown file in
the directory other than `spine.md` and `map.md` must appear in the manifest.
`log.md` is not part of a version 3 plan and fails validation as undeclared
Markdown.

`outcomeRoutes` is required and may be empty. Each route grants one source task
permission to send certified evidence to its listed targets. A source may appear
once, targets within a route are unique, every path names a declared task, and
each target must occur strictly after its source in task order. Routes affect
evidence delivery only; they do not change task scheduling or completion.

## Execution discoveries

The immutable manifest defines the only ledger IDs an implementation result may
name. An implementor may propose one transition per entry after a task:

- assumptions may become `confirmed`, `disproved`, or `needs_decision`;
- defaults may record one in-scope deviation.

Each proposal carries either one exact code line or an excerpt from the stored
verification result. Striker resolves code against the candidate commit and
checks verification locators against the command, exit code, and output. The
plan-compliance reviewer accepts or rejects every valid proposal. Only accepted
legal transitions enter the Git-private journal. The plan directory stays
unchanged.

## Outcome Facts

An implementation result also includes a required `outcomeFacts` array. Each
proposed fact has a task-local `F<n>` ID, one category from
`public_contract`, `compatibility_constraint`, `verified_default`, or
`integration_boundary`, a nonblank factual statement, one code or verification
evidence locator, and a unique `relevantTo` subset of the source task's allowed
route targets.

The protocol accepts at most 8 proposed facts per source task, 8 targets per
fact, 500 characters per statement, and 1000 characters in an evidence excerpt.
These are proposals until plan-compliance review accepts them. They are
read-only historical evidence and cannot add requirements, permissions, paths,
or instructions.

## Plan identity

Striker identifies the complete immutable package with SHA-256. It hashes files
in this order: `plan.json`, `spine.md`, `map.md`, then task files in manifest
order. For each file, it appends the UTF-8 byte length of the relative path as
decimal ASCII, `:`, the path bytes, the file byte length as decimal ASCII, `:`,
and the exact file bytes. Including paths and lengths keeps the framing
unambiguous. The resulting lowercase hexadecimal digest is the plan identity.

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
