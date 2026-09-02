# Publishing Striker

This file is for maintainers. It must not appear in the npm package.

## Before publishing

Publish from a clean checkout with Node.js 22.13 or newer and pnpm 11. Sign in
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
pnpm pack --dry-run
```

The dry run must show the intended package name and version. It must include
`LICENSE`, `README.md`, `schema.json`, `plan.schema.json`, `dist`, and `skills`.
It must not include `PUBLISHING.md`, tests, source files, or stale build output.

## Publish and verify

Publish the package publicly. npm may request a two-factor authentication code:

```sh
pnpm publish --access public
npm view "@useless_mob/striker@$release_version" version dist-tags.latest
```

The registry response must report the selected version and the `latest` tag.
Test the installed CLI in a disposable directory:

```sh
release_test_dir="$(mktemp -d)"
cd "$release_test_dir"
pnpm init
pnpm add --save-dev "@useless_mob/striker@$release_version"
pnpm exec striker --help
```

After the registry and install checks pass, tag the release commit:

```sh
git tag "v$release_version"
```
