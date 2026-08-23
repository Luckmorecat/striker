---
name: striker-preparation
description: Turn any intent source into a draft for Striker Spec.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
---

# Striker preparation

Prepare one complete specification draft from an idea, request, foreign brief,
foreign specification, foreign plan, or old Striker artifact. Stop before
specification approval and implementation planning.

## Establish the source

Resolve the target Git root. Inspect the source and relevant repository
behavior.

When the source claims to be an approved Striker brief, read
[BRIEF-FORMAT.md](BRIEF-FORMAT.md) and verify its format and approval. When it
claims to be an approved Striker specification, read
[SPEC-FORMAT.md](SPEC-FORMAT.md) and verify its format and approval. Treat every
other artifact as unapproved recovery input.

If a valid approved Striker specification needs no revision, stop and report
that preparation is already complete.

Separate recovery input into desired behavior and exclusions, implementation
suggestions, and claims about current behavior. Verify claims about current
behavior against the repository. Keep an implementation suggestion only when the
developer confirms that it expresses a public, data, security, compatibility,
deployment, or quality constraint for the specification.

## Settle the intent

Track every unresolved choice that could change the outcome, actors and
permissions, required behavior, public contracts, data or security rules,
compatibility or deployment constraints, quality constraints, or exclusions. Ask
the developer every product or contract choice that the source leaves
unresolved. Repository evidence can settle only claims about current behavior.
Do not create a separate brief.

The intent is settled when every material choice is resolved or explicitly
deferred. For each deferral, state why it does not block the required behavior
and when it must be resolved.

## Draft the specification

Read [SPEC-FORMAT.md](SPEC-FORMAT.md) if it is not already loaded. Draft the
specification content with its headings and requirement syntax. Omit the
approved frontmatter and approval record because `$striker-spec` owns approval
and writing. The recovered intent controls desired behavior. Repository code
describes current behavior.

Present the complete draft, then print:

```text
Next: $striker-spec <draft-above>
```

Stop without invoking `$striker-spec`.
