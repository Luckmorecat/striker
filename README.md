# Striker

Striker is a private, project-local task dispatcher for implementation plans. It
reads an ordered Striker plan, opens one fresh agent session per task, checks
the resulting commit and worktree, runs the task's verification command, and
records completion before moving to the next task.

The package requires Node.js 22.13 or newer and pnpm. It supports Codex, Claude
Code, OpenCode, and Pi through `acpx@0.13.1`. Publishing, global installation,
and automatic harness switching are outside this package's current scope.

## Install

Install `@kisshot/striker` as a development dependency from the private package
source used by your project:

```sh
pnpm add --save-dev @kisshot/striker@<private-package-spec>
```

For local package testing, build and pack this repository, then install the
tarball in the consumer project:

```sh
pnpm build
pnpm pack --pack-destination /tmp
pnpm add --save-dev /tmp/kisshot-striker-0.0.0.tgz
```

Do not install Striker globally. The public skills and their agents must use the
version in the target project's `node_modules/.bin` directory.

## Install the public skills

Striker ships four public, explicit-only skills:

- `$striker-shape` turns an open product decision into an approved brief.
- `$striker-spec` turns shaped intent into an approved behavioral specification.
- `$striker-plan` creates and validates a plan for an approved specification.
- `$striker` operates the project-local CLI.

The package also ships `striker-preparation`, a non-invocable reference tree
shared by Shape, Spec, and Plan. Install the complete set for the selected
harness from the project root:

```sh
pnpm exec striker skills install --harness codex
```

The other accepted harness values are `claude`, `opencode`, and `pi`. Matching
installs are no-ops. Striker refuses to overwrite conflicting local skill
content. It never installs public or configured third-party skills as a side
effect of `run`.

Every canonical tree is installed under `.agents/skills`. Claude also receives
aliases under `.claude/skills` so the skills can resolve their shared sibling
references. The Striker implementor remains private package content. The plan
adapter injects it into task sessions, and `skills install` does not expose or
install it.

## Configure a project

Create `striker.config.json` at the Git root:

```json
{
  "$schema": "./node_modules/@kisshot/striker/schema.json",
  "taskSource": "striker-plan",
  "harness": "codex",
  "skills": []
}
```

`taskSource` must be `striker-plan`. `harness` defaults to `codex`. `skills` is
a list of additional agent skills that must already be installed. Before a run
changes Git or creates recovery state, Striker checks the selected harness,
authentication, and every configured skill in a disposable read-only session. It
stops instead of selecting another harness when preflight fails.

The configuration schema is packaged as `schema.json` and exported as
`@kisshot/striker/schema.json`.

## Prepare work

Striker preparation has four explicit stages:

```text
$striker-shape -> approved brief
$striker-spec  -> approved specification
$striker-plan  -> validated Striker plan
$striker       -> plan execution
```

Start at the first missing artifact. Use Shape when product direction, outcome,
or scope remains open. Spec accepts an approved brief or an already-shaped
request. Plan accepts only an approved specification. Each stage stops after its
own approval or operation and prints the concrete path and invocation for the
next stage. It never invokes the next skill on its own.

A small, already-shaped bug can start at Spec:

```text
$striker-spec <bug request>
$striker-plan .striker/specifications/<slug>.md
$striker run .striker/plans/<slug>/<spec-hash-prefix>/
```

Briefs and specifications are approved version 1 Markdown artifacts.
Specifications give every normative requirement a stable `R<n>` identifier and
an observable acceptance condition. Project-local preparation files use this
layout:

```text
.striker/
  briefs/<slug>.md
  specifications/<slug>.md
  plans/<slug>/<spec-hash-prefix>/
    plan.json
    spine.md
    map.md
    <ordered task files>
```

Add the following entry to the consumer project's `.gitignore`:

```gitignore
.striker/
```

The installer and skills do not edit `.gitignore` without separate
authorization.

The plan directory uses the first 12 hexadecimal characters of the SHA-256 of
the exact approved specification bytes. `spine.md` records the specification
path and full hash and embeds an immutable copy of the specification. Version 2
plans contain no mutable log. The manifest declares typed planning assumptions,
local defaults, and strict task order:

```json
{
  "$schema": "./node_modules/@kisshot/striker/plan.schema.json",
  "version": 2,
  "taskSource": "striker-plan",
  "assumptions": {
    "A1": {
      "statement": "The CLI owns command registration.",
      "evidence": [{ "path": "src/cli.ts", "line": 42 }]
    }
  },
  "defaults": {
    "D1": {
      "statement": "Use the existing command naming pattern.",
      "reason": "Adjacent commands use it.",
      "reversalCost": "Rename one internal option and its tests."
    }
  },
  "tasks": ["01-first-task.md", "02-second-task.md"]
}
```

The ledger objects are required and may be empty. Assumptions use `A<n>`
property names and one or more repository file and line citations. Defaults use
`D<n>` property names and record a reason and reversal cost. Object keys make
ledger IDs unique. Version 1 plans are rejected.

The complete plan is the executable package for one approved specification.
Striker derives its identity from the exact bytes and relative paths of
`plan.json`, `spine.md`, `map.md`, and every declared task. A vertical task is
one ordered, independently green implementation unit within that plan. Each task
traces its requirements in `Build` and also has `Paths`, `Test contract`, and
`Verify` sections. The `Verify` section contains one shell command, which
Striker later runs once from the Git root through `/bin/sh -lc`. See
[`skills/striker-plan/PLAN-FORMAT.md`](skills/striker-plan/PLAN-FORMAT.md) for
the complete format.

Validate a plan without running it:

```sh
pnpm exec striker plan validate path/to/plan
```

The external `$settle` and `$next-slice` workflows inspired Striker. They are
not accepted plan formats, runtime dependencies, or product terminology inside a
Striker plan.

## Run and recover

Set the checkout-local permission mode, then dispatch all remaining tasks:

```sh
pnpm exec striker permissions attended
pnpm exec striker run path/to/plan
```

Striker refuses a dirty repository by default. `--allow-dirty` permits a run
only when task changes preserve the initial patch and do not overlap its paths:

```sh
pnpm exec striker run path/to/plan --allow-dirty
```

After each task, Striker requires one strict implementation-result JSON object,
one descendant commit, an unchanged allowed dirty baseline, and the exact
verification result. The result has a required `discoveries` array. Each item
proposes a transition for one manifest `A<n>` assumption or `D<n>` default and
cites either an exact candidate-commit line or a checked verification excerpt.
An empty array means the task found no ledger change.

Striker rejects unknown IDs and citations that do not match the exact candidate
or stored verification before review. It then starts fresh read-only standards
and plan-compliance reviewers for the exact start and candidate commits. The
plan reviewer receives the task contract, immutable spine and map context,
changed paths, verification, passed standards result, and resolved discovery
evidence. Each reviewer returns one strict JSON object. The plan reviewer
accepts or rejects every proposal. Striker accepts findings only for Git-derived
changed paths.

A blocking finding from either review resumes the preserved implementation
session with the typed findings. The implementor amends its one task commit.
Striker reruns verification, standards review, and plan-compliance review
against the amended commit. Both passed results must match the final candidate
before `task_completed`. The journal records each review and repair stage for
recovery. The implementation session reads plan context but never updates the
plan directory or reviews its own work.

Striker keys one persistent event journal by the immutable plan identity under
Git-private checkout storage. The journal records each run, task selection,
baseline, attempt, session, continuation, failure, attention state, completion,
source conflict, discovery decision, ledger transition, discard, and terminal
completion. The active-run file is only a lock and lookup index. Successful
completion and explicit discard release that claim without deleting plan
history. `snapshot.json`, `task-state.json`, and `log.md` are rebuildable
projections. Striker repairs or recreates them from `events.ndjson` after an
interrupted projection write, without rerunning a completed implementation
session.

One nonterminal run may exist per checkout. Inspect or operate it with:

```sh
pnpm exec striker status
pnpm exec striker resume
pnpm exec striker answer < answer.txt
pnpm exec striker answer --file answer.txt
pnpm exec striker retry
pnpm exec striker discard --force
```

Inspect one plan's retained state and chronological completion log with:

```sh
pnpm exec striker plan status path/to/plan
pnpm exec striker plan log path/to/plan
```

Both commands accept absolute paths or paths relative to the current directory.
They validate the immutable plan to derive its identity, then replay its
Git-private events before reading any projection. `plan status` lists every task
revision and state, the active run and attempt, attention, recorded reviews, and
the assumption and default states. A plan without events reports `not_started`.
`plan log` prints an empty `# Plan log` view in that case. Neither command
creates authoritative events. `striker status` remains limited to the active
checkout run.

An accepted default deviation or confirmed assumption records its transition and
continues. An accepted disproved or undecidable assumption completes the current
task, pauses before selecting another task, and requires `striker answer` with a
developer decision. Status and log projections include the proposal, review
decision, transition, evidence, and pause reason.

`resume` continues an interrupted implementation or repair session. An
interrupted reviewer is replaced with a fresh read-only review pinned to the
same candidate. `answer` continues a paused implementation session with
developer input. `retry` records the failed attempt and starts the incomplete
task in a fresh session. `discard --force` records a terminal discard only for a
paused or failed run, then releases the active claim. All plan events remain
Git-private after completion or discard.

## Permission modes

Permission settings live in Git-private checkout state. Tracked project
configuration cannot grant unattended access.

- `attended` is the default. Striker relays write and execution requests to the
  developer and rejects them when no interactive input is available.
- `auto-review` is Codex-only. Each task session uses `workspace-write`,
  on-request approval, and the Codex automatic approval reviewer. Other
  harnesses fail preflight.
- `unattended` passes approve-all to `acpx`. Select it explicitly for the local
  checkout.

Change modes with
`pnpm exec striker permissions attended|auto-review|unattended`. The active mode
is printed when a run starts.

## Typed API

The package root exports the injected dispatcher, adapter registry, task-source
contracts, run and recovery types, project configuration schema, and plan
manifest schema:

```ts
import {
  AdapterRegistry,
  Dispatcher,
  type DispatcherDependencies,
  type TaskSourceAdapter,
} from "@kisshot/striker";
```

Only the package root and the two JSON schemas are public export paths.

## Development and smoke tests

The default checks use fake runners and temporary Git repositories. They never
contact an installed harness:

```sh
pnpm check
pnpm build
pnpm pack --dry-run
```

Real-harness smoke testing is opt-in. Use a disposable, committed Git checkout,
select its harness in `striker.config.json`, authenticate that harness, choose
the `attended` permission mode, and run a small validated plan with
`pnpm exec striker run <plan>`. A real smoke run opens agent sessions and may
create a task commit, so do not point it at this repository or an unreviewed
working tree.
