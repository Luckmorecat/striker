# Striker

Striker is a task dispatcher for implementation plans. It reads an ordered
Striker plan, opens one fresh agent session per task, checks the resulting
commit and worktree, runs the task's verification command, and records
completion before moving to the next task.

The package requires Node.js 22.19 or newer. Development uses pnpm. It supports
Docker execution by default with Codex and Pi through `acpx@0.13.1`. Explicit
local execution also supports Claude Code and OpenCode. The harness is selected
per repository; failures stop execution without fallback. See the
[isolated execution guide](docs/isolated-execution.md) and
[platform acceptance status](docs/release-acceptance.md).

## Install

Install once to use Striker across repositories without adding a project
dependency:

```sh
npm install --global @useless_mob/striker
striker --help
```

Ensure your package manager's global executable directory is on PATH. Run
Striker from the target Git repository. Configuration, permissions, and run
state remain per repository; installing globally does not configure projects. A
global upgrade changes the version used by all projects relying on PATH.

For a project-pinned version, local installation remains supported:

```sh
pnpm add --save-dev @useless_mob/striker
pnpm exec striker --help
```

The examples below use `striker` for a global installation. With a local
installation, use `pnpm exec striker` instead. Agent skills follow the shared
[CLI selection procedure](skills/striker/CLI.md): they prefer the target
repository's local executable, then fall back to PATH when it is absent.

To test a checkout as an installed package without changing your global
installation or a consumer project's dependencies:

```sh
pnpm test:global-install
```

This packs the checkout, installs it with runtime dependencies into a temporary
global prefix, and checks executable selection, help, plan validation, and skill
installation from a separate repository. It requires npm, Git, a POSIX shell,
and registry access. It cleans up its temporary installation afterward.

## Install the public skills

Striker ships five public, explicit-only skills:

- `$striker-preparation` turns any intent source into a draft for
  `$striker-spec`.
- `$striker-shape` turns an open product decision into an approved brief.
- `$striker-spec` turns shaped intent into an approved behavioral specification.
- `$striker-plan` creates and validates a plan for an approved specification.
- `$striker` operates the CLI.

Preparation also contains the format references shared by Shape, Spec, and Plan.
Install the complete set for the selected harness from the project root:

```sh
striker skills install --harness codex
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
  "taskSource": "striker-plan",
  "harness": "codex",
  "skills": []
}
```

`taskSource` must be `striker-plan`. `harness` defaults to `codex`. `skills` is
a list of unique extra skill names installed under `.agents/skills/<name>` in
the project. Only packaged Striker skills and these named extras load in Docker.
`image`, `model`, and `reasoningEffort` are optional; see the execution guide
for local image approval and the tested `gpt-5.6-sol` / `low` default.

The optional `$schema` field is omitted so these examples work with either
installation mode. Runtime validation still applies. For editor autocomplete
with a local install, point `$schema` at the installed schema file relative to
the JSON document.

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
striker plan validate path/to/plan
```

The external `$settle` and `$next-slice` workflows inspired Striker. They are
not accepted plan formats, runtime dependencies, or product terminology inside a
Striker plan.

## Run and recover

Prepare the local image and broker-owned subscription login, then dispatch from
a clean source checkout:

```sh
striker environment prepare
striker auth prepare --broker /absolute/path/to/cli-proxy-api
striker auth login
striker run path/to/plan
```

Docker execution requires a clean repository. Explicit local selection persists
for this checkout and warns about host access and personal configuration. Local
`--allow-dirty` permits only non-overlapping changes preserving the initial
patch:

```sh
striker run path/to/plan --execution local --allow-dirty
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

A blocking finding starts a fresh isolated repair thread with typed findings;
local execution reuses the implementation session. The implementor amends its
one task commit. Striker reruns verification, standards review, and
plan-compliance review against the amended commit. Both passed results must
match the final candidate before `task_completed`. The journal records each
review and repair stage for recovery. The implementation session reads plan
context but never updates the plan directory or reviews its own work.

Striker keys one version 11 persistent event journal by the recorded plan
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
request before its first turn begins. Older journal versions are not accepted
and are not migrated or deleted automatically.

One nonterminal run may exist per checkout. Inspect or operate it with:

```sh
striker status
striker resume
striker answer                  # interactive multiline answer
striker answer < answer.txt
striker answer --file answer.txt
striker retry
striker discard --force
```

When stdin and stderr are terminals, `run`, `resume`, `retry`, and `answer`
display a run dashboard on stderr: the plan with its certified, active and
pending tasks, the task pipeline (preparing, implementing, verifying, standards
review, plan review, completed), the session and execution context, elapsed
time, and the live activity lines. Blocking review findings stay red while
automatic repair runs, previous checks are marked recheck required at repair
start, and findings resolve only on a passing review of the repaired candidate.
Each new repair opens the next implementation round; resuming the same
interrupted repair keeps its round. A restarted `answer`, `resume` or `retry`
restores rounds and review history from the existing journal.

The two activity lines follow the agent while it works, in local and isolated
execution alike: `LIVE` shows its latest visible note and `TOOL` its latest tool
summary, each bounded to one line and stripped of terminal control sequences.
Reasoning text is never shown. Activity is ephemeral and is not recorded in the
journal, so a restarted command shows stage information until the agent speaks
again, and a stage whose agent reports nothing keeps its own truthful line.

Press `m` to toggle motion and `d` to toggle the detail line; with details
expanded, the arrow keys move the plan window up or down from the active task
and scroll a finding list larger than the terminal. The active task stays
visible automatically, and the live activity lines stay on screen however long
the plan is. `q` does not cancel an executing run; interruption behavior is
unchanged. Below 76 visible columns the dashboard shows the pipeline alone. On
completion Striker restores the terminal and prints the result summary without
waiting for acknowledgment.

Each pause keeps the dashboard on screen and opens the prompt directly below it,
showing the task and complete persisted attention detail. Assumption decisions
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

All four commands accept `--no-interactive` to disable the dashboard along with
attention and permission prompts, leaving plain stage lines. This does not
change the configured permission mode or grant permission: a request needing
terminal approval is rejected. With the composer disabled, `answer` without
`--file` reads stdin until EOF. Redirecting either stdin or stderr also disables
terminal prompts. Plain output reports lifecycle stages only; streamed agent
activity is left to the dashboard. Noninteractive attention and failures exit 1
with recovery guidance; completion exits 0. Ctrl-C/EOF behavior above applies
while waiting for input, not while agents execute. Requires Node.js >=22.19.

Inspect one plan's retained state and chronological completion log with:

```sh
striker plan status path/to/plan
striker plan log path/to/plan
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
interrupted Docker reviewer resumes its recorded thread and read-only snapshot.
Local review recovery starts a fresh reviewer pinned to the same candidate.
`answer` continues a paused implementation session with developer input. `retry`
records the failed attempt and starts the incomplete task in a fresh session.
`discard --force` records a terminal discard only for a paused or failed run,
then releases the active claim. All plan events remain Git-private after
completion or discard.

After each certified task, the exact commit is exported to host branch
`codex/striker-<run-id>` while the source checkout stays unchanged. A later
failure preserves completed work. Apply the whole successful feature explicitly
with `striker apply <run-id>`; it requires the original clean branch at its
starting commit and preserves the commit sequence. Changed targets and
divergence are refused. No automatic merge, rebase, squash or push occurs.

Discard stops isolated execution but retains files.
`striker cleanup <run-id> --force` removes inactive retained execution
resources, including unexported work, while preserving the host result branch
and audit journal. It refuses active features/running containers. Apply remains
possible after cleanup. See the [execution guide](docs/isolated-execution.md)
for interruption recovery, network exceptions, derived images and the isolation
boundary.

## Permission modes (local execution)

Permission settings live in Git-private checkout state. Tracked project
configuration cannot grant unattended access.

- `attended` is the default. Striker relays write and execution requests to the
  developer and rejects them when no interactive input is available.
- `auto-review` is Codex-only. Each task session uses `workspace-write`,
  on-request approval, and the Codex automatic approval reviewer. Other
  harnesses fail preflight.
- `unattended` passes approve-all to `acpx`. Select it explicitly for the local
  checkout.

Change modes with `striker permissions attended|auto-review|unattended`. The
active mode is printed when a run starts.

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

The default checks use fake runners and temporary Git repositories. They need
neither Docker nor subscription credentials:

```sh
pnpm check
pnpm build
pnpm pack --dry-run
```

Release acceptance runs separately on Linux and macOS Docker hosts, with both
fake endpoint tests and authenticated smoke tests for each supported harness:

```sh
pnpm test:docker
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke --harness codex
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke --harness pi
```

These commands fail when prerequisites are missing. Real smoke tests consume
subscription usage and refresh broker-owned credentials. See
[release acceptance](docs/release-acceptance.md) for actual evidence and
blockers.
