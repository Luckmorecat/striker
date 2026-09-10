# Subscription compatibility gate

Status: pending as of 2026-09-11. Docker execution must not be activated on the
strength of this investigation. Neither harness has passed authenticated
subscription, refresh, or search acceptance through a Striker gateway.

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

Complete a broker-owned subscription login using private host-only auth storage.
Keep its listener on loopback, management and request logging disabled, and its
API key outside execution mounts. No authenticated calls were made during this
investigation. Existing personal credentials were not read or copied.

Then implement and prove the narrow run gateway, curated harness integration,
network enforcement, and explicit authenticated smoke commands. Both harnesses
must demonstrate streaming, cancellation, tool calls, retained context, actual
subscription refresh, and search with useful source links. Missing credentials
or skipped checks are not acceptance. No model/effort default or transport has
been validated, and no runtime pins were changed.

The repository currently has no `test:smoke` command, credential broker, run
gateway, or Docker egress enforcement. Those remain pending gate work. A broker
binary starting successfully and passing ordinary `pnpm check` do not establish
subscription compatibility or isolation.
