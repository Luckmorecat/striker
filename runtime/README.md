# Local environment preparation

Run `striker environment prepare` from a configured Git project to build and
cache the bundled baseline. Docker must be installed, running, and accessible to
the current user. Preparation needs public package/base-image downloads. Only
this packaged runtime directory is sent as build context; project files, Git
metadata, personal configuration, and credentials are excluded.

The command prints the actual immutable local image ID and records it in the
Git-private `striker/prepared-image.json`. Feature execution remains local at
this stage. Container allocation is an infrastructure API; it creates a stopped,
network-disabled container and empty checkout/state/output directories. Checkout
population and execution wiring follow in later slices.

For another toolchain, first prepare the baseline, then find its local tag with
`docker image ls --filter reference='striker-baseline:*'`. Build a derived image
locally, replacing the placeholder below with that exact tag:

```dockerfile
FROM striker-baseline:<prepared-baseline-hash>
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ruby && rm -rf /var/lib/apt/lists/*
USER 1000:1000
```

Build it yourself with `docker build -t my-striker:local .`, add
`"image": "my-striker:local"` to `striker.config.json`, and run
`striker environment prepare --approve-image`. Approval is local and tied to the
resolved image ID. Moving the tag to a new image requires approval again.
Striker never pulls a configured image or builds a project's Dockerfile. Derived
images must retain the pinned toolchain and baseline label and cannot declare
volumes. Only use images whose build inputs you trust.

Local limits and approved image IDs live in Git-private
`striker/execution.json`:

```json
{
  "approvedImages": [],
  "resources": { "cpus": 4, "memoryMiB": 8192, "pids": 512 }
}
```

Limits apply to retained containers; no task timeout is imposed. Each container
uses the current non-root host UID/GID for private bind-mount access. The root
filesystem is read-only, capabilities are dropped, privilege escalation is
blocked, and `/tmp` supplies bounded writable scratch. Dependencies installed in
the checkout or state directory survive container restarts. System tools belong
in a derived image.

Run `pnpm test:docker prepare` for real Docker acceptance. Missing Docker access
is an error. Ordinary `pnpm check` requires neither Docker nor credentials.
Harness/adapter pins in `baseline.json` are installation pins; authenticated
model/search compatibility is a separate gate, not established by preparation.

## Host subscription setup

Install the pinned CLIProxyAPI release listed in
[BROKER-COMPATIBILITY.md](BROKER-COMPATIBILITY.md), verify its published
checksum, then run these commands from the Git project:

```sh
striker auth prepare --broker /absolute/path/to/cli-proxy-api
striker auth login
striker auth status
```

Preparation checks the version, copies the executable into private Git state,
and records its digest. Login opens the broker's browser authorization flow;
only the host broker stores access and refresh credentials. Status reports
whether broker-owned login records are present, not whether a live model request
will succeed. Native Codex auth files are not imported or shared. An existing
**broker-owned** Codex auth directory can be selected explicitly with
`auth prepare --broker <path> --auth-directory <directory>`; stop any other
broker using it first. Striker serializes login/use of that directory. After a
crash, its lock is retained: verify the old broker is stopped before removing
`.striker-broker-lock` from that auth directory.

The broker binds only loopback, uses separate random model and management keys,
and disables request logs and the control panel. The container receives only a
revocable run key through a selectively mounted socket. It cannot call broker
management/login routes or choose another upstream or model. A live run can
consume permitted subscription usage.

## Isolated model and service settings

The default isolated selection is `gpt-5.6-sol` with reasoning effort `low`.
Project configuration may override it:

```json
{
  "taskSource": "striker-plan",
  "harness": "pi",
  "model": "gpt-5.6-sol",
  "reasoningEffort": "low"
}
```

Supported effort values are `low`, `medium`, `high`, and `xhigh`. Preparation of
run connectivity checks the broker's model catalog and records the selection; an
unavailable model fails without fallback. These fields configure isolated
connectivity; the existing local runner does not consume them. Broad Docker run
composition follows in the next slice.

Public HTTP/HTTPS uses authenticated HTTP proxy/CONNECT traffic over the socket.
Direct networking stays disabled. Private, link-local, reserved, and host
interface addresses are denied, including after DNS resolution or redirects.
Services running inside the feature container remain reachable on loopback.
Additional services require exact names, ports, and pinned IP addresses in the
host-only `striker/execution.json`, never tracked project configuration:

```json
{
  "approvedImages": [],
  "resources": { "cpus": 4, "memoryMiB": 8192, "pids": 512 },
  "services": [
    { "name": "test-api.local", "port": 8080, "addresses": ["127.0.0.1"] }
  ]
}
```

The grant permits only that name/port. Do not grant host credential stores,
Docker APIs, or broker management. Host gateway descriptors record the grants
and selection outside the container's writable mounts.

## Explicit acceptance

Offline boundary tests use fake credentials and endpoints:

```sh
pnpm test:docker network credentials
```

Real subscription acceptance consumes subscription usage and refreshes the
broker-owned login through its supported management API. Prepare/login first,
stop other broker processes using that auth directory, then run:

```sh
export STRIKER_SMOKE_BROKER_ROOT="$(git rev-parse --path-format=absolute --git-path striker/broker)"
pnpm test:smoke subscription --harness codex
pnpm test:smoke subscription --harness pi
```

Each command requires Docker and real authentication and fails if either is
missing. It verifies refresh persistence, terminal execution, streamed output,
cited search, retained context after reconnecting, stream cancellation, and
public HTTP/HTTPS from a restricted container. Ordinary `pnpm check` never runs
these authenticated calls. Smoke timeouts bound acceptance only; they do not
impose production task timeouts.

## Explicit isolated feature execution

After preparing the current image and broker-owned login, run a clean committed
project with `striker run <plan-directory> --execution docker`. Codex and Pi are
supported. Local execution remains the default during rollout; Docker errors
stop execution.

The host selects tasks and owns the journal. The retained container owns an
independent Git checkout, verification, acpx, and every harness child process.
Each stage stops the preceding container processes before starting. Reviews use
read-only snapshots and separate scratch directories. The Linux container kernel
must support Landlock ABI 3 or newer; unsupported restrictions fail closed. See
the
[kernel's Landlock documentation](https://docs.kernel.org/userspace-api/landlock.html).

Only packaged Striker skills and explicitly configured project skills are
enabled. Extra names resolve under `.agents/skills/<name>/SKILL.md`; duplicate
names, metadata aliases, missing resources, and symlinked resource paths are
rejected. Repository instructions remain available. Future plan tasks are read
from the host when selected; delivered task and stage inputs are retained with
their recorded identity.

Work remains in the private `environments/<run-id>/checkout` directory after the
container stops. Status and discard use the host journal. Docker recovery is
available as described below. Certified tasks are exported to the host as
described below.

### Recover an isolated feature

`striker resume` and `striker answer` reopen the recorded Docker environment;
`striker retry` starts a fresh task thread while retaining its checkout and
installed dependencies. The journal binds recovery to the original image,
harness, model/effort, resource limits, frozen skills and stage inputs. Changing
project defaults does not change a paused run. Revoked image approvals or local
service grants must be restored before recovery can reconnect.

Interrupted reviewers retain their original read-only snapshot and session.
Missing containers, images, frozen inputs or session files stop recovery rather
than replacing its identity. Restore the missing resources, or explicitly retry
when only the task session was lost. Memory/process/storage failures retain
files and report attention. If Docker reports the container was OOM-killed,
inspect the retained work and use `striker retry`; recorded limits still apply.

Only one command may execute or mutate an active project run at a time. A dead
host's operation lease can be reclaimed; its supervised broker stops before
releasing the credential lease. An unverifiable lease fails closed with an
inspection instruction. Recovery stops orphaned workers before delivering work.
Journal versions before v10 are rejected without modifying the old files.

Future task text stays live under the run's original plan identity. Future
task-list edits are accepted; routes and ledger definitions remain bound to its
recorded manifest. Completed task edits are still refused. Current task/review
inputs stay frozen.

Recovery acceptance is separate from ordinary checks:

```sh
pnpm test:docker recovery resource-limits
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke recovery --harness codex
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke recovery --harness pi
```

### Inspect certified results on the host

After each task passes verification and both reviews, Striker imports its exact
commit to `codex/striker-<run-id>` in the original repository. Run output and
`striker status` show the branch, exported head and any pending export error.
Use `git log codex/striker-<run-id>` or `git diff HEAD...codex/striker-<run-id>`
to inspect the completed prefix; a later failed task leaves that prefix intact.
The source branch and worktree stay unchanged.

Export refuses existing unrelated, changed, symbolic or checked-out result
branches. Restore the expected result ref (or switch its worktree to another
branch), then use `striker resume` to retry export without repeating a certified
task. Retain the host journal and `refs/striker/exports/<run-id>` ownership ref;
they recover interruptions before or after the result branch advances. Transfers
validate Git objects in a temporary bare repository and disable host Git hooks,
helpers and network fetching. A transfer exceeding 128 MiB fails explicitly and
retains the work. Cleanup remains a later rollout step; export performs no push.

Run `pnpm test:docker result-export` for explicit Docker export acceptance.

### Apply a completed feature

Apply a completed feature explicitly with `striker apply <run-id>` from its
original source checkout. The entire feature must have completed successfully
and exported all certified commits. The command preserves that commit sequence
and advances only the recorded original branch, still at its starting commit,
with a clean index/worktree. It rechecks the result branch and ownership receipt
under Git locks; changed branches, dirty files, concealed index entries, and
ignored files obstructing the result are refused. Host hooks, fsmonitor, and
configured conversion filters do not execute during application.

Apply needs neither Docker nor subscription access. It retains the result
branch, execution artifacts, and journal. A repeat after a recorded apply is
idempotent if the source still matches the completed result. After interruption,
retry the same command: durable intent permits completing a fully installed
checkout or recording an already advanced ref. Partial checkout state or later
user changes require explicit inspection with `git status` and comparison to the
printed result branch; Striker never resets them. If Git reports stale locks,
verify that their owning processes have stopped before removing those locks
manually. Manual integration of the result branch remains available
independently.

Journal v11 records the original source path plus application and cleanup
intent/completion. Older journals are rejected without migration or automatic
deletion. Application is available by run ID even after another run begins; it
shares the project operation lease with execution and recovery.

`striker discard --force` ends a paused or failed run, stops its retained
container and revokes run connectivity, while keeping files available for
inspection. `striker cleanup <run-id> --force` explicitly deletes an inactive
run's checkout (including unexported work), agent state, scratch, inputs and
outputs, and removes its stopped container. It refuses running features and
running containers. Stop the command and discard paused/failed execution first
if its container is still running. Cleanup never removes the host result branch,
export ownership ref, journal, recovery/audit metadata, broker login or shared
prepared image. Retry the same cleanup command after a partial deletion. Once
cleanup starts, resume/answer/retry cannot continue that execution; discard any
remaining paused run to release it. Completed features can still be applied from
their host result branch after cleanup. Nothing is garbage-collected
automatically.
