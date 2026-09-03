# ADR 0001: Task Outcome authority and routing

- Status: accepted
- Date: 2026-09-03

## Context

Later implementation tasks need selected facts learned by completed tasks
without turning implementation output into an instruction channel. Striker
already uses an append-only journal as durable truth and treats projections as
rebuildable. Plans are immutable and identify every task by path and content
revision.

## Decision

Journal events own Task Outcome truth. A Task Outcome is derived only from
persisted implementation evidence, independent plan-compliance decisions, and a
matching completed-task event. Outcome projections are disposable and must be
rebuildable from the journal.

Immutable version 3 plans own Outcome Routes. A route names one source task and
one or more strictly later target tasks. Implementors may select only a subset
of their source task's allowed targets for each proposed Outcome Fact; review
must certify the fact and its selection before either can contribute to an
outcome.

Outcome Facts are historical, read-only evidence. They cannot add requirements,
permissions, paths, or instructions to the target task.

## Consequences

- Runtime model output is a proposal, never authoritative Task Outcome state.
- Routing changes alter plan identity and cannot be introduced during a run.
- Missing or corrupt outcome projections can be replaced from journal replay.
- Plan version 2 and journal versions 2 through 5 are unsupported.
