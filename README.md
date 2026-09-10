# Striker

Striker is a project-local task dispatcher for implementation plans. It reads an
ordered Striker plan, opens one fresh agent session per task, checks the
resulting commit and worktree, runs the task's verification command, and records
completion before moving to the next task.

The package requires Node.js 22.19 or newer and pnpm. It supports Codex, Claude
Code, OpenCode, and Pi through `acpx@0.13.1`. Global installation and automatic
harness switching are outside this package's scope.

## Install

Install `@useless_mob/striker` as a development dependency from npm:

```sh
pnpm add --save-dev @useless_mob/striker
```

For local package testing, build and pack this repository, then install the
tarball in the consumer project:

```sh
pnpm build
pnpm pack --pack-destination /tmp
pnpm add --save-dev /tmp/useless_mob-striker-0.1.0.tgz
```

Do not install Striker globally. The public skills and their agents must use the
version in the target project's `node_modules/.bin` directory.

## Install the public skills

Striker ships five public, explicit-only skills:

- `$striker-preparation` turns any intent source into a draft for
  `$striker-spec`.
- `$striker-shape` turns an open product decision into an approved brief.
- `$striker-spec` turns shaped intent into an approved behavioral specification.
- `$striker-plan` creates and validates a plan for an approved specification.
- `$striker` operates the project-local CLI.

Preparation also contains the format references shared by Shape, Spec, and Plan.
Install the complete set for the selected harness from the project root:

```sh
pnpm exec striker skills install --harness codex
```

The other accepted harness values are `claude`, `opencode`, and `pi`. Matching
installs are no-ops. Striker refuses to overwrite conflicting local skill
content. It never installs public or configured third-party skills as a side
effect of `run`.

Every canonical tree is installed under `.agents/skills`. Claude also receives
aliases under `.claude/skills` so the skills can resolve their shared sibling
references. The Striker implementor remains package-internal content. The plan
adapter injects it into task sessions, and `skills install` does not expose or
install it.

## Configure a project

Create `striker.config.json` at the Git root:

```json
{
  "$schema": "./node_modules/@useless_mob/striker/schema.json",
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
`@useless_mob/striker/schema.json`.

## Prepare work

The standard Striker workflow has four explicit stages:

```text
$striker-shape -> approved brief
$striker-spec  -> approved specification
$striker-plan  -> validated Striker plan
$striker       -> plan execution
```

Use `$striker-preparation` when the input is an external idea, brief,
specification, or plan. It recovers and settles the intent, then hands a
complete draft to `$striker-spec` for approval.

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
path and full hash and embeds an immutable copy of the specification. Version 3
plans contain no mutable log. The manifest declares typed planning assumptions,
local defaults, immutable Outcome Routes, and strict task order:

```json
{
  "$schema": "./node_modules/@useless_mob/striker/plan.schema.json",
  "version": 3,
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
  "outcomeRoutes": [
    { "from": "01-first-task.md", "to": ["02-second-task.md"] }
  ],
  "tasks": ["01-first-task.md", "02-second-task.md"]
}
```

The ledger objects are required and may be empty. Assumptions use `A<n>`
property names and one or more repository file and line citations. Defaults use
`D<n>` property names and record a reason and reversal cost. Object keys make
ledger IDs unique. Outcome Routes use declared task paths, have unique sources
and targets, and point strictly forward. Only version 3 plans are accepted.

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
verification result. The result has required `discoveries` and `outcomeFacts`
arrays. Each discovery proposes a transition for one manifest `A<n>` assumption
or `D<n>` default and cites either an exact candidate-commit line or a checked
verification excerpt. An empty array means the task found no ledger change.

Each Outcome Fact has a task-local `F<n>` ID, a closed factual category, a
bounded statement, exact code or verification evidence, and a `relevantTo`
selection from the source task's immutable Outcome Route. Facts are proposals
until plan-compliance review accepts them; they are read-only historical
evidence and cannot introduce requirements or instructions.

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

Striker keys one version 6 persistent event journal by the immutable plan
identity under Git-private checkout storage. The journal records each run, task
selection, baseline, attempt, session, continuation, failure, attention state,
completion, source conflict, discovery decision, ledger transition, discard, and
terminal completion. The active-run file is only a lock and lookup index.
Successful completion and explicit discard release that claim without deleting
plan history. `snapshot.json`, `task-state.json`, and `log.md` are rebuildable
projections. Striker repairs or recreates them from `events.ndjson` after an
interrupted projection write, without rerunning a completed implementation
session.

The `task_session_started` event stores the exact prepared implementation
request before its first turn begins. Journal versions 2 through 5 are not
accepted.

One nonterminal run may exist per checkout. Inspect or operate it with:

```sh
pnpm exec striker status
pnpm exec striker resume
pnpm exec striker answer                  # interactive multiline answer
pnpm exec striker answer < answer.txt
pnpm exec striker answer --file answer.txt
pnpm exec striker retry
pnpm exec striker discard --force
```

When stdin and stderr are terminals, `run`, `resume`, `retry`, and `answer` stay
attached across repeated pauses. Each pause shows the task and complete
persisted attention detail on stderr in normal scrollback. Assumption decisions
open a Pi multiline composer directly. Operational pauses offer the available
Answer, Resume repair, and Retry actions plus Leave paused; use arrow keys and
Enter to select. Unavailable or ineffective continuations are omitted. Enter
submits; Shift+Enter inserts a newline, with Alt+Enter as a fallback. Multiline
paste stays in the editor. Blank interactive answers reprompt; nonblank content
retains its surrounding whitespace. Ctrl-C exits 130 and Ctrl-D/EOF exits 0,
submitting nothing and printing `Run left paused.`

Answer eligibility is checked before reading input and rechecked on submission.
Files and piped stdin retain their complete UTF-8 content and submit once. This
automation path returns after that continuation, even if it pauses again.

All four commands accept `--no-interactive` to disable attention and permission
prompts. This does not change the configured permission mode or grant
permission: a request needing terminal approval is rejected. With the composer
disabled, `answer` without `--file` reads stdin until EOF. Redirecting either
stdin or stderr also disables terminal prompts. Noninteractive attention and
failures exit 1 with recovery guidance; completion exits 0. Ctrl-C/EOF behavior
above applies while waiting for input, not while agents execute. Requires
Node.js >=22.19.

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
} from "@useless_mob/striker";
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
