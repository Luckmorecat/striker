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
