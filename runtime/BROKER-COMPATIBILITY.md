# Subscription compatibility gate

Status: pending as of 2026-09-11. Docker execution must not be activated on the
strength of this investigation. Both harnesses produced terminal and
subscription-search outputs through a Striker gateway. Codex completed its
prompt; Pi did not. Neither passed the complete refresh/context/cancel gate.

## Inspected candidate

CLIProxyAPI release `7.2.157`, source commit
`09a29bd345bc44c473abe7fd07859e32df2ea543`, was downloaded for a host-side
probe. The Linux amd64 release archive matched the published SHA256:
`e0df9f570b6e910a14f081425cee2527a503311f617d7727cd428009fab14c77`. The binary's
help output confirmed its version and these login options:

- `-codex-login`: browser OAuth login.
- `-codex-device-login`: device-code login.
- `-config`: explicit broker configuration path.
- `-no-browser`: print browser-login instructions instead of opening a browser.

The inspected CLI exposes no Codex credential-import command; its import option
is for Vertex service accounts. Do not translate or share a user's existing
Codex refresh-token file as an assumed supported import. Use a separate broker
login unless a supported import path is established.

[Release and checksums](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.157)
and
[CLI source](https://github.com/router-for-me/CLIProxyAPI/blob/09a29bd345bc44c473abe7fd07859e32df2ea543/cmd/server/main.go).

## Pi integration constraint

The cached baseline image
`sha256:fedee2d1c4f730ed6b34a34167910cf378c8e0d6cab83447f0c15a646273bdf6` was
inspected without network access. It contains `pi-acp 0.0.33` and
`@mariozechner/pi-coding-agent 0.73.1`, as declared in `baseline.json`.

The official CLIProxyAPI Pi provider `1.4.15`, source commit
`ffc7cc3fe05b64483651b427e5117ae22dd6aad0`, instead declares
`@earendil-works/pi-coding-agent >=0.82.0` and `@earendil-works/pi-ai` peers. It
cannot be adopted unchanged against the baseline's declared packages. Its Codex
stream integration patches the installed Pi implementation and selects WebSocket
transport without SSE fallback. This is evidence about that provider, not proof
that a curated Striker provider cannot use SSE.

[Provider manifest](https://github.com/router-for-me/pi-cliproxyapi-provider/blob/ffc7cc3fe05b64483651b427e5117ae22dd6aad0/package.json)
and
[stream implementation](https://github.com/router-for-me/pi-cliproxyapi-provider/blob/ffc7cc3fe05b64483651b427e5117ae22dd6aad0/extensions/codex-stream.ts).

## Resume requirements

A broker-owned subscription login was completed. The host broker returned a
completed `web_search_call` and cited source URLs over SSE using `gpt-5.6-sol`
and effort `low`. This selection is a tested probe candidate, not a validated
release default.

Both pinned adapters then ran inside the cached image with `--network none`,
read-only root, dropped capabilities, and a selectively mounted gateway socket.
They executed `printf STRIKER_TOOL_OK` and produced cited subscription-search
outputs. Codex completed its prompt; Pi probes timed out after both 90 and 240
seconds (container exit 3). The container received a revocable run key, never
real OAuth tokens. Pi used its supported `openai-responses` custom provider plus
a curated search extension; the newer official Pi provider was not installed.
Codex used a curated search MCP tool because its custom-provider session exposed
no native search.

Pi `0.73.1` contains no `agent_settled` event, while `pi-acp 0.0.33` resolves
pending prompts only on that event (`dist/index.js:1208–1231` in the installed
adapter). Successful streamed output therefore does not establish prompt
completion. The runtime/adapter pins need compatibility testing as a pair before
this gate can pass; no pin was changed during this attempt.

Codex/acpx overrides the config's sandbox mode with its initial agent mode. The
successful isolated probe selected `INITIAL_AGENT_MODE=agent-full-access`;
Docker remained the enforcement boundary. The default mode instead failed nested
sandbox creation and returned exit zero despite failed tools. Future acceptance
must inspect completed tool outputs and search citations, not just process exit.

Real refresh remains unproven. Automatic approval review rejected a proposed
forced-expiry edit to the sole broker auth record because it could invalidate
the login. That edit was not executed; user approval is pending. The inspected
broker also provides `POST /v0/management/auth-files/refresh`, but management is
disabled in the running probe and no management refresh was attempted. Neither a
mocked refresh nor the completed login counts as refresh acceptance.

Complete the curated harness integration, broker lifecycle/CLI configuration,
network allocation integration, and explicit authenticated smoke commands. Both
harnesses must demonstrate streaming, cancellation, tool calls, retained
context, actual subscription refresh, and search with useful source links.
Missing credentials or skipped checks are not acceptance. No model/effort
default or transport has been validated, and no runtime pins were changed.

The gateway implementation in `src/infrastructure/gateway/` now tests run-scoped
authentication, fixed upstream/model selection, subscription-search citations,
stream cancellation, revocation, and pinned HTTP/CONNECT destinations. The
separate `pnpm test:docker network credentials` tests prove socket-only egress
with a fake named service, blocked direct/private/host access, and working
internal services. They also verify denied management/login routes, cross-run
access, and redaction of upstream error bodies. They do not run subscription
calls. No run command uses this gateway yet.

There is still no `test:smoke` command or broker lifecycle/CLI integration.
Context retention, harness cancellation, real refresh, real-credential lifecycle
acceptance, and macOS acceptance remain unproven. No runtime pins, project model
schema, execution defaults, or recovery contracts changed.
