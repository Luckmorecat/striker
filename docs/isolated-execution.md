# Isolated execution

Docker is the default for new runs. Codex and Pi are supported inside Linux
containers; Claude Code and OpenCode require explicit local execution. Docker,
image, authentication, model, or policy failures stop the run without fallback.
Linux acceptance is recorded in [release acceptance](release-acceptance.md).
macOS release acceptance remains blocked until the full suite runs on a macOS
Docker host. Container kernels must support Landlock ABI >=3; unsupported
kernels fail closed. Native macOS builds and Windows are outside this release.

## Prepare once per project

Use Node.js >=22.19 and an accessible local Docker daemon as a non-root user.
Create and commit `striker.config.json` at the Git root:

```json
{
  "taskSource": "striker-plan",
  "harness": "codex",
  "model": "gpt-5.6-sol",
  "reasoningEffort": "low",
  "skills": []
}
```

`gpt-5.6-sol` / `low` is the tested default for both harnesses. Effort may also
be `medium`, `high`, or `xhigh`. Model availability is checked, with no
fallback. See [baseline.json](../runtime/baseline.json) and
[broker compatibility](../runtime/BROKER-COMPATIBILITY.md) for the validated
pins. Local harnesses use their own model settings.

```sh
striker environment prepare
striker auth prepare --broker /absolute/path/to/cli-proxy-api
striker auth login
striker auth status
striker run path/to/plan
```

Preparation explicitly builds the packaged Node/pnpm baseline and caches its
immutable local image ID. It downloads base-image/packages and sends only the
packaged runtime as build context. Striker does not automatically build a
project Dockerfile or pull a configured registry image. See
[derived images](derived-images.md) for extra system toolchains.

Install CLIProxyAPI **7.2.157**, verifying its published checksum before
preparing it. The broker owns subscription login and refresh on the host. Native
Codex credentials are not imported. An existing broker-owned store may be
explicitly reused with
`auth prepare --broker <binary> --auth-directory <directory>`; stop other
processes using it first. There is no required API billing or paid search
credential. Authenticated execution consumes subscription usage.

## Local controls and extra skills

An explicit `striker run <plan> --execution local` persists local selection for
this checkout and warns about host access and personal configuration on each
local run/recovery, without another confirmation. `--execution docker` persists
Docker again. Recovery always follows the recorded run, regardless of a new
selection. Local permission choices remain `attended`, `auto-review` (Codex
only), and `unattended`, controlled by `striker permissions <mode>`.
`--allow-dirty` is local-only and preserves only non-overlapping changes.

Locate the private policy with:

```sh
git rev-parse --path-format=absolute --git-path striker/execution.json
```

This host-local JSON file controls selection, limits, approved image IDs, and
network exceptions; tracked project configuration cannot authorize them. Edit it
while no project command is running, preserving existing approvals/grants:

```json
{
  "backend": "docker",
  "approvedImages": [],
  "resources": { "cpus": 4, "memoryMiB": 8192, "pids": 512 },
  "services": [
    { "name": "test-api.local", "port": 8080, "addresses": ["127.0.0.1"] }
  ]
}
```

The service example explicitly permits that exact name and port through the
HTTP/HTTPS gateway to its pinned address. It does not enable arbitrary TCP or
SSH. Do not grant access to Docker APIs, credential stores, or broker
management. Public HTTP/HTTPS is allowed by default; private/LAN/host
destinations and direct outbound connections are denied. Container-local test
services remain reachable. Limits default to 4 CPUs, 8 GiB and 512 processes.
There is no fixed task timeout.

Only Striker's packaged skills load automatically. Install extras locally at
`.agents/skills/<name>/SKILL.md` and list each name in `skills`. Names use
letters, digits, underscores and hyphens, start with a letter or digit, and
match the skill's frontmatter `name`. Names must be unique and must not collide
with the packaged set. Missing entries, symlinks and aliases fail preparation.
Unlisted skills do not auto-load. Repository instructions remain available.

## Boundary and retained work

One feature owns one independent retained checkout and container. The host owns
plan selection, journal, access policy and credentials. Verification, harnesses,
ACP filesystem/terminal operations, Git task commands and children execute
inside the container. It has a read-only root, no capabilities, no privilege
escalation, restricted networking and selective private artifact mounts.

Every new implementation, review and repair stage starts a fresh thread and
isolated HOME. Reviews receive enforced read-only snapshots and writable
scratch; previous stage processes are stopped. Personal host homes, skills,
configuration, credentials, original checkout and host journal are not mounted.
Explicit extra skills and repository files are still inputs; a fresh HOME is not
a promise that repository content is trustworthy. Public internet access permits
data transfer to public services; outbound data-loss prevention is not provided.

Writable dependencies and files survive interruption. System packages belong in
a derived image. Run output shows the run ID, image/model and artifact
directory. `striker status` shows the recorded environment and available
recovery commands:

```sh
striker status
striker resume
striker answer --file answer.txt
striker retry
```

An interrupted stage resumes its recorded thread, including a review snapshot.
Explicit retry starts a fresh task thread while keeping dependencies/files.
Resume uses recorded image, model/effort, limits, grants and frozen skill/stage
inputs. Changing project defaults cannot change a paused run. Revoked image or
service approvals must be restored. Missing resources fail with restoration
instructions; preparing a new environment cannot replace the old one. Inspect
OOM/process/storage failures before retrying; recorded limits still apply.

Future task text and task lists remain live on the host under the original plan
identity. Already delivered stage inputs stay frozen; completed task edits are
refused. Routes and ledger definitions stay bound to the original manifest.
Journal v11 is required; old journals are rejected without migration or
deletion.

## Inspect, apply and clean up

After each task passes verification and both reviews, its exact commit appears
on the original repository's `codex/striker-<run-id>` branch. The source
checkout stays unchanged during execution. A later task failure preserves the
completed prefix. Inspect it using `git log <result-branch>` or
`git diff HEAD...<result-branch>`. Unexpected branch changes stop export;
restore the expected ref and use `striker resume` to export without repeating
the task. Git object transfers above 128 MiB fail explicitly and retain work.

```sh
striker apply <run-id>
striker discard --force
striker cleanup <run-id> --force
```

Apply requires whole-feature success, fully exported commits, and the original
clean branch still at its starting commit. It preserves commits and refuses
changed targets, dirty/obstructing files and divergence. It never merges,
rebases, squashes or pushes. Retry an interrupted apply; partial checkout state
requires inspection rather than reset. After successful apply, a matching repeat
is idempotent. Apply works without Docker/login and after cleanup.

Discard ends paused/failed execution, stops workers and revokes connectivity,
while retaining files. Cleanup deletes an inactive run's stopped container,
checkout including unexported work, dependencies, agent state, inputs and
outputs. It refuses running features/containers. Retry the same cleanup after
partial deletion. Once cleanup begins, that execution cannot continue.

Cleanup preserves the result branch, `refs/striker/exports/<run-id>` ownership
receipt, journal and recovery/stage audit metadata, broker login and shared
image/cache. No automatic garbage collection occurs. Keep the journal and
receipt for recovery/application. One active run and one mutating command per
project are permitted; see [runtime operations](../runtime/README.md) for lease
diagnostics.
