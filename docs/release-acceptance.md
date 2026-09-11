# Docker release acceptance

Docker default activation is implemented. Publication remains blocked on macOS
Docker acceptance: this implementation session has only a Linux host, with no
macOS Docker endpoint or runner available. Do not infer macOS support from Linux
containers or a skipped test.

## Commands required on each host

```sh
pnpm check
pnpm test:docker
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke --harness codex
STRIKER_SMOKE_BROKER_ROOT=/private/prepared-broker pnpm test:smoke --harness pi
```

Record OS/architecture, Docker engine/kernel and image identity with the
results. Authenticated smoke covers subscription refresh, tools,
streaming/cancellation, cited search, reconnecting context, public HTTP/HTTPS,
feature execution and recovery for both harnesses. Missing prerequisites must
fail, never skip.

The approved baseline is [runtime/baseline.json](../runtime/baseline.json),
CLIProxyAPI 7.2.157, `gpt-5.6-sol` / `low`, SSE. Pins are unchanged from the
[compatibility gate](../runtime/BROKER-COMPATIBILITY.md).

## Evidence

Linux host: x86_64, Docker Engine 29.7.2, kernel 7.1.9-arch1-2. Tested image:
`sha256:bf946f25dcb9058920e0b002b657d340737c4b85db11c2da13bc7d843e28cdb1`. The
only available Docker context is the local Linux daemon.

- 2026-09-11 Linux: default CLI acceptance passed for Codex and Pi, including
  two certified task commits, unchanged source, host branch export, cleanup and
  apply.
- Full Linux Docker suite: 16 files, 26 tests passed (363.02 seconds), including
  boundary, recovery, resource-limit, export, cleanup and default CLI
  acceptance.
- Full authenticated Codex suite: 3 files, 3 tests passed (502.34 seconds).
- Full authenticated Pi suite: 3 files, 3 tests passed (430.49 seconds).
- All explicit Linux acceptance tests ran without skips.
- macOS Docker and authenticated suites: blocked; no macOS host is available.
