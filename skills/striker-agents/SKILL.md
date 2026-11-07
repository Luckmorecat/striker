---
name: striker-agents
description:
  Create, audit, or simplify repository AGENTS.md instructions using repository
  evidence and bounded empirical findings.
---

# Striker agents

Improve repository instructions for a concrete task or recurring failure. Keep
only guidance that changes an agent's decisions; no change is a valid outcome.

## Inspect

- Read the applicable instruction hierarchy, linked skills, and authoritative
  commands or configuration. Check the target harness's discovery behavior
  before relying on nested files.
- Identify the requested behavior or observed failure. Separate explicit user
  requirements from assumptions and optional recommendations.
- Read [the evidence summary](references/evidence.md) when justifying a practice
  or planning an evaluation. Do not present shorter files, nesting, or more
  comprehensive templates as proven performance improvements.

## Edit

- Preserve required constraints. Remove stale or contradictory instructions only
  after checking their source; do not discard an unusual rule merely for
  brevity.
- Write concrete triggers and actions. Keep repository-wide rules at the root;
  scope local rules to the directories where the harness will apply them.
- Link reusable procedures with a clear trigger instead of copying them. Verify
  paths and commands. Avoid restating discoverable repository structure or rules
  already enforced by tooling unless they address a demonstrated problem.
- Keep task plans, incident history, and research discussion outside
  always-loaded instructions. Do not impose a universal line limit or fill a
  template for its own sake.
- Make the smallest useful change. Do not rewrite unrelated skills, install
  tooling, change permissions, or publish changes without authorization.

## Verify

Check instruction scope, conflicts, reference targets, and command accuracy.
Report which requirements the diff preserves and what behavior it changes.

For a performance claim, compare the baseline and candidate on representative
held-out tasks with the same repository snapshot, harness/model, permissions,
and budget. Use fresh isolated sessions, repeat trials when practical, and score
correctness, instruction adherence, and cost/time separately. Keep validation
criteria fixed before seeing results; do not expose expected answers to agents.
Do not weaken required safeguards in a comparison. Without such an evaluation,
report a design assessment, not a demonstrated improvement. A few smoke tests
provide preliminary evidence only.

Return the concise diff or proposed text, checks performed, and remaining
limits.
