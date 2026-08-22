# Planning a blank area

Read this file only after Plan classifies the relevant repository area as blank.
The approved specification already supplies the behavior and scope.

## Record the blank state

Inventory the relevant directories and record the absence of:

- implementation that could establish local conventions;
- build or runtime configuration;
- tests and a test runner.

State which paths were inspected. An absence is not an `A<n>` assumption.

## Resolve foundational choices

Resolve only implementation choices required by the approved specification.
These may include the runtime, framework, build setup, test runner, deployment
mechanism, persistence mechanism, and external service integration.

Ask about hard-to-reverse choices. Use a `D<n>` default only when one task can
reverse it. If a choice would change approved behavior or constraints, return to
`$striker-spec` as required by `SKILL.md`.

## Choose the first green boundary

Prefer the thinnest demonstrable behavior that establishes the toolchain needed
to build and verify it.

Keep setup and the first behavior in one task when they share a deterministic
green boundary. Use a separate bootstrap task only when setup can be complete,
green, and verifiable on its own.
