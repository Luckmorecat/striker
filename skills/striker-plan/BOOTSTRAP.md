# Planning a blank project

Read this file only after classifying the relevant repository area as blank. The
common process in `SKILL.md` still applies.

## Confirm that the goal is plannable

Distinguish a concrete feature request from an open product idea. A concrete
request names a caller or actor, an observable result, and a use case that can
be demonstrated. An open idea still needs decisions about what users can do or
what outcome defines success.

Plan the concrete request. For an open idea, stop and ask for a narrower
implementation goal or an approved product brief. Product shaping is outside
this skill.

## Record the blank state

Inventory the relevant directories and record the absence of:

- implementation that could establish local conventions;
- build or runtime configuration;
- tests and a test runner.

State which paths were inspected. Do not invent code citations or convert an
absence into an `A<n>` assumption.

## Resolve foundational decisions

Ask only questions required by the requested use cases. Cover these areas when
they affect those use cases:

- runtime and framework;
- deployment target;
- public contracts and compatibility requirements;
- persistent data and migration needs;
- authentication and authorization;
- private or regulated data;
- external services;
- ongoing operational cost.

Ask in dependency order. For example, settle the deployment target before asking
about framework choices that depend on it. Record answers as user decisions with
their reasoning.

Use a `D<n>` default only for a local choice that one task can reverse. State
the reason and concrete reversal cost. Do not default public contracts,
persistent data models, security or privacy policy, deployment, external
services, or recurring cost.

## Choose the first green boundary

Prefer a thin, demonstrable use case that establishes only the toolchain needed
to deliver and verify that behavior. Keep setup and the first behavior in one
vertical task when they can share a deterministic green boundary.

Create a separate bootstrap task only when the toolchain cannot reach the same
green boundary as the first use case. The bootstrap task must still be complete
and verifiable on its own. Do not create empty framework setup merely to make
later tasks possible.
