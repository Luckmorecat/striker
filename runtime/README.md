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
