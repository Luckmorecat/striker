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

Striker ships two public, explicit-only skills:

- `$striker` operates the project-local CLI.
- `$striker-plan` creates and validates a versioned Striker plan.

Install both for the selected harness from the project root:

```sh
pnpm exec striker skills install --harness codex
```

The other accepted harness values are `claude`, `opencode`, and `pi`. Matching
installs are no-ops. Striker refuses to overwrite conflicting local skill
content. It never installs public or configured third-party skills as a side
effect of `run`.

The Striker implementor is private package content. The plan adapter injects it
into task sessions, and `skills install` does not expose or install it.

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

## Create a Striker plan

Invoke `$striker-plan` with an approved implementation goal. The skill inspects
the repository, agrees the test seams with you, writes the plan, and validates
it with the project-local CLI.

A version 1 plan contains:

```text
plan.json
spine.md
map.md
log.md
<ordered task files declared by plan.json>
```

The manifest declares the plan provenance and task order:

```json
{
  "$schema": "./node_modules/@kisshot/striker/plan.schema.json",
  "version": 1,
  "taskSource": "striker-plan",
  "tasks": ["01-first-task.md", "02-second-task.md"]
}
```

Each task has `Build`, `Paths`, `Test contract`, and `Verify` sections. The
`Verify` section contains one shell command, which Striker later runs once from
the Git root through `/bin/sh -lc`. See
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

After each task, Striker requires one descendant commit, an unchanged allowed
dirty baseline, the exact verification result, the human plan log entry, and
both implementor review results. It then appends a machine-readable completion
marker to `log.md`. The marker remains after successful local recovery state is
deleted and lets a later run reconcile completed work.

One nonterminal run may exist per checkout. Inspect or operate it with:

```sh
pnpm exec striker status
pnpm exec striker resume
pnpm exec striker answer < answer.txt
pnpm exec striker answer --file answer.txt
pnpm exec striker retry
pnpm exec striker discard --force
```

`resume` continues an interrupted session or sends a repair request back to a
paused session. `answer` continues that same session with developer input.
`retry` records the failed attempt and starts the incomplete task in a fresh
session. `discard --force` deletes recovery state only for a paused or failed
run. Paused and failed journals remain Git-private until recovery or explicit
discard; successful journals are removed.

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
