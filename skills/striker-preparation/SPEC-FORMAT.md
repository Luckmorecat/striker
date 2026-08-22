# Striker specification format version 1

A specification records approved behavior and constraints. Implementation tasks,
paths, and verification commands belong in the plan.

Store approved specifications at:

`.striker/specifications/<slug>.md`

## Frontmatter

Use exactly:

```yaml
---
artifact: striker-specification
version: 1
status: approved
slug: example-slug
---
```

The slug uses lowercase letters, digits, and single hyphens. It matches the
filename.

## Structure

Use these headings in order:

```markdown
# Specification title

## Intent source

## Outcome

## Actors and permissions

## Requirements

### R1: Requirement title

- Behavior:
- Acceptance:

## Public contracts

## Data and security

## Compatibility and deployment

## Quality constraints

## Exclusions

## Deferred decisions

## Approval
```

The title, `Intent source`, `Outcome`, `Actors and permissions`, `Requirements`,
and `Approval` must contain content.

`Intent source` names the approved brief path or summarizes the shaped request.

Each normative behavior has a unique `R<n>` identifier. Its `Behavior` states
what must happen. Its `Acceptance` states the stimulus and observable result
that prove it.

Requirements cover successful behavior, meaningful variants, failures, and
boundaries. Keep identifiers for unchanged requirements when revising a
specification. Never reuse an identifier for different behavior.

`Deferred decisions` records why each unresolved decision does not block the
approved behavior and when it must be resolved.

Use `None.` only for `Public contracts`, `Data and security`, `Compatibility and
deployment`, `Quality constraints`, `Exclusions`, and `Deferred decisions`.

End `Approval` with:

```text
The developer approved this specification as written on YYYY-MM-DD.
```
