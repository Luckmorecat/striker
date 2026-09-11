# Add a toolchain with a local derived image

First run `striker environment prepare` in a configured project. Find its cached
tag using `docker image ls --filter reference='striker-baseline:*'` and use the
exact tag for the prepared baseline:

```dockerfile
FROM striker-baseline:<prepared-baseline-hash>
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ruby && rm -rf /var/lib/apt/lists/*
USER 1000:1000
```

Build it explicitly:

```sh
docker build -t my-striker:local .
```

Set `"image": "my-striker:local"` in `striker.config.json`, then run
`striker environment prepare --approve-image`. Preparation probes the pinned
baseline tools and records approval of the immutable local image ID. Moving the
tag requires approval again. The derived image must preserve the baseline label
and toolchain and cannot declare volumes. Trust and inspect its build inputs.

Striker uses the non-root host UID/GID at runtime. Root filesystem writes and
system package installations are unavailable during tasks; writable project
libraries/tool dependencies can be installed in the retained checkout/state.
Linux containers do not provide native macOS builds. Striker never builds a
project Dockerfile automatically and never pulls a configured image. Resume
continues using the recorded image; rebuilding does not upgrade a paused run.
