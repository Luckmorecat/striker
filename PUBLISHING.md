# Publishing Striker

This file is for maintainers. It must not appear in the npm package.

## Before publishing

Publish from a clean checkout with Node.js 22.19 or newer and pnpm 11. Sign in
to npm as the owner of the `@useless_mob` scope, with two-factor authentication
enabled. Never store an npm token or one-time password in this repository.

Each npm package version is immutable. Update `package.json` to a new semantic
version before publishing a release after `0.1.0`.

Confirm the checkout and npm identity:

```sh
git status --short
npm whoami
release_version="$(node -p "require('./package.json').version")"
```

The worktree must be clean, and `npm whoami` must print `useless_mob`.

## Check the package

Install the locked dependencies, run the repository checks, and inspect the
exact package contents:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:global-install
pnpm pack --dry-run
```

The dry run must show the intended package name and version. It must include
`LICENSE`, `README.md`, `schema.json`, `plan.schema.json`, `dist`, and `skills`.
It must not include `PUBLISHING.md`, tests, source files, or stale build output.

## Docker release gate

Before publishing, run `pnpm test:docker` and both
`STRIKER_SMOKE_BROKER_ROOT=<prepared-broker> pnpm test:smoke --harness codex|pi`
on Linux and macOS Docker hosts. Record exact platform, image and results in
`docs/release-acceptance.md`. Missing/skipped acceptance is a release blocker.
Ordinary `pnpm check` must remain independent of Docker and login. The package
must include `runtime`, worker output under `dist/runner/worker`, and the linked
execution guides under `docs`.

## Publish and verify

Publish the package publicly. npm may request a two-factor authentication code:

```sh
pnpm publish --access public
npm view "@useless_mob/striker@$release_version" version dist-tags.latest
```

The registry response must report the selected version and the `latest` tag.
Test the published CLI in a disposable global prefix (POSIX shell):

```sh
release_test_dir="$(mktemp -d)"
npm install --global --prefix "$release_test_dir/global" "@useless_mob/striker@$release_version"
mkdir "$release_test_dir/consumer"
(cd "$release_test_dir/consumer" && "$release_test_dir/global/bin/striker" --help)
rm -rf "$release_test_dir"
```

After the registry and install checks pass, tag the release commit:

```sh
git tag "v$release_version"
```
