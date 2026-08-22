# Striker brief format version 1

A brief records one approved product direction. It defines the problem,
intended outcome, chosen direction, and scope. Detailed behavior belongs in the
specification.

Store approved briefs at:

`.striker/briefs/<slug>.md`

## Frontmatter

Use exactly:

```yaml
---
artifact: striker-brief
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
# Brief title

## Problem and outcome

## Chosen direction

## Scope

### In scope

### Out of scope

## Constraints

## Repository evidence

## Risks

## Alternatives

## Deferred to specification

## Approval
```

The title, `Problem and outcome`, `Chosen direction`, `In scope`, and `Approval`
must contain content.

`Problem and outcome` names the actors, present problem, and intended result.

`Chosen direction` states the approved direction and why it was chosen.

`Constraints` records limits that affected the direction.

`Repository evidence` contains only evidence relevant to feasibility or the
chosen direction. Cite repository-relative `path:line` locations and state what
each citation establishes.

`Risks` records material uncertainty or cost that remains after approval.

`Alternatives` names each material rejected direction and its rejection reason.

`Deferred to specification` lists behavioral or contract questions that do not
change the approved direction.

Use `None.` only for `Out of scope`, `Constraints`, `Repository evidence`,
`Risks`, `Alternatives`, and `Deferred to specification`.

End `Approval` with:

```text
The developer approved this brief as written on YYYY-MM-DD.
```
