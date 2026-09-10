# Subscription compatibility gate

Authenticated Linux gate passed on 2026-09-11. Both Codex and Pi completed real
subscription refresh, terminal execution, streaming, cancellation, context
retention after reconnecting, and subscription search with source URLs from a
restricted Docker container. Public HTTP and HTTPS also passed. Docker feature
execution/default activation remains later work; macOS acceptance is pending.

## Tested selection

| Component                        | Pin                                    |
| -------------------------------- | -------------------------------------- |
| CLIProxyAPI (host only)          | 7.2.157                                |
| acpx                             | 0.13.1                                 |
| Codex                            | @openai/codex 0.154.0                  |
| Codex adapter                    | @agentclientprotocol/codex-acp 1.11.0  |
| Pi                               | @earendil-works/pi-coding-agent 0.85.1 |
| Pi adapter                       | pi-acp 0.0.33                          |
| Default model / reasoning effort | gpt-5.6-sol / low                      |
| Model transport                  | SSE, Responses API                     |

The exact runtime pins are authoritative in `baseline.json`; the broker pin is
in `src/infrastructure/gateway/broker-storage.ts`. Preparation records the
immutable local image ID and baseline asset hash. The final tested image is
recorded with verification results in the slice log.

CLIProxyAPI source commit: `09a29bd345bc44c473abe7fd07859e32df2ea543`. The
downloaded Linux amd64 release archive matched the published SHA256:
`e0df9f570b6e910a14f081425cee2527a503311f617d7727cd428009fab14c77`. See the
[release and checksums](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.157)
and
[CLI source](https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/cmd/server/main.go).

## Authentication and transport

The inspected broker has no supported native Codex credential-import command. A
separate broker-owned browser login succeeded. Striker may reuse that broker
store explicitly; it never translates or shares native harness OAuth files. The
supported `POST /v0/management/auth-files/refresh` operation succeeded, advanced
the persisted refresh timestamp, and left a valid future expiry; real
model/search requests then succeeded. An earlier forced-expiry edit was rejected
by automatic approval review and was never executed. The user authorized the
supported refresh operation. No manual expiry edits were needed.

The host broker owns real credentials. A narrow run gateway replaces upstream
authentication and fixes the selected model/effort. Execution receives a
revocable run key and a single mounted UNIX socket, with direct Docker
networking disabled. Host-only management uses a separate key and is not exposed
through the gateway. No required API billing or paid search credential was used.

Codex uses a custom Responses provider and a curated `striker_search` MCP tool.
`INITIAL_AGENT_MODE=agent-full-access` is required inside the Docker boundary:
the adapter overrides ordinary sandbox config, and its default nested sandbox
fails in this container. Acceptance checks actual terminal output and completed
search calls, not just process exit.

Pi uses its supported `openai-responses` custom provider with a run key, plus
the packaged curated search extension. It does not use dummy native OAuth or the
official CLIProxyAPI Pi provider's WebSocket patch. D1 (SSE) holds. Both search
integrations return broker search results with required source citations;
upstream errors are sanitized by the gateway.

## Regressions and next-slice constraints

The old Pi 0.73.1 / pi-acp 0.0.33 pair emitted tool/search output but timed out
at 90 and 240 seconds. That Pi version lacks the `agent_settled` event on which
the adapter waits for prompt completion. The renamed Pi 0.85.1 pair completes
and is now pinned. Search-extension dependencies must load through Pi's
extension loader; a CommonJS resolution attempt failed against Pi AI's
import-only exports. The offline Docker startup test covers this regression.

Pi reports search completion separately from its initial named tool event; smoke
correlates events by tool-call ID. It supports retained connection close/reopen,
but not ACP `session/close` for deleting backend session state. Smoke closes the
connection and removes its owned container/state. Later execution/recovery code
must not assume `discardPersistentState: true` is supported by this adapter.

Run `pnpm test:smoke subscription --harness codex` and the equivalent `pi`
command with `STRIKER_SMOKE_BROKER_ROOT` pointing to a prepared, logged-in host
broker. Each uses real refresh and model calls; missing prerequisites fail.
`pnpm check` stays offline. `pnpm test:docker network credentials` uses fake
endpoints to verify authorization/redaction, blocked direct/private/host access,
named grants, internal services, and packaged Pi startup.

See [runtime setup and acceptance](README.md) for commands, model overrides,
local service grants, and credential-store lock recovery.
