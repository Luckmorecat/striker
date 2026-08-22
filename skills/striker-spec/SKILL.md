---
name: striker-spec
description: Create or revise an approved specification from shaped intent.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Striker spec

Create or revise one approved specification of observable behavior. Stop before
implementation planning.

## Establish the intent

Accept:

- an approved brief;
- an already-shaped request whose direction, outcome, and scope are settled;
- an existing specification that needs revision.

A small, clear bug is the common direct path.

When given a brief, read
[BRIEF-FORMAT.md](../striker-preparation/BRIEF-FORMAT.md)
and verify its format and approval state.

When given an existing specification, read
[SPEC-FORMAT.md](../striker-preparation/SPEC-FORMAT.md)
and verify its format, approval state, and intent source.

When product direction or major scope remains open, stop and print:

```text
Next: $striker-shape <brief-path-or-request>
```

Inspect the relevant repository behavior. The approved brief or shaped request
controls desired behavior. Repository code describes current behavior.

## Specify the behavior

Cover actors, permissions, successful behavior, meaningful variants, failures,
boundaries, public contracts, relevant data and security decisions,
compatibility, deployment constraints, quality constraints, and exclusions.

Ask only questions that can change observable behavior or its public
constraints. Leave paths, task order, test commands, and reversible
implementation choices for `$striker-plan`.

If resolving a question would change an approved brief's direction, outcome,
scope, or major exclusions, stop and print:

```text
Next: $striker-shape <brief-path-or-request>
```

Treat a difference between desired and current behavior as work to be planned.
Surface contradictions that make the desired behavior ambiguous, inconsistent,
or infeasible.

The specification is ready when every in-scope behavior has an observable
acceptance condition and each material product or contract decision is resolved
or explicitly deferred.

## Approve the specification

Read
[SPEC-FORMAT.md](../striker-preparation/SPEC-FORMAT.md)
if it is not already loaded, then draft the specification.

Ask:

> Approve this specification as written?

Apply requested changes and ask again. After unambiguous approval, write:

`.striker/specifications/<slug>.md`

Reuse an existing slug only when revising that specification. Edit `.gitignore`
only with separate authorization.

Print:

```text
Approved specification: .striker/specifications/<slug>.md
Next: $striker-plan .striker/specifications/<slug>.md
```

Stop without invoking the next skill.
