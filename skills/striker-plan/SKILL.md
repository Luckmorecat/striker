---
name: striker-plan
description:
  Use only when the developer explicitly invokes $striker-plan to create a
  versioned Striker implementation plan.
metadata:
  opencode/autoinvoke: "false"
---

# Striker plan

Proceed only when the developer explicitly invoked `$striker-plan`.

Create a Striker plan from a concrete implementation goal or an approved product
brief. This skill is the planning authority. Do not invoke or depend on another
planning skill.

## Establish the goal

Before discovery, check that the goal identifies:

- an actor or caller;
- an observable outcome;
- at least one use case that can be demonstrated;
- the first boundary that can be made green.

If any item is missing, ask for it. If the request is an open product idea whose
behavior still needs shaping, stop and ask for a concrete implementation goal or
an approved product brief. Do not invent product behavior to make it plannable.

Treat the developer's concrete request, answers, and approved product brief as
authoritative for desired behavior. Treat repository code as authoritative for
current behavior. Documentation and reported behavior are evidence, not a
substitute for either authority.

## Discover the repository

Classify the relevant area before planning:

- **Established** means nearby implementation, tests, and conventions provide
  precedents for most decisions.
- **Sparse** means some relevant precedents exist, but important local choices
  remain unanswered.
- **Blank** means there is no relevant implementation, build configuration, or
  test setup to follow.

For a blank project, read [BOOTSTRAP.md](BOOTSTRAP.md) and follow its branch in
addition to this process. Do not read it for established or sparse areas.

Inspect the feature folder first, then its parent, then the wider repository.
For every choice the implementation depends on:

1. Name the decision and the work it can block.
2. Search those scopes in order for the nearest precedent.
3. Record an established choice as a code-backed `A<n>` assumption. Cite the
   file and line and state what the evidence establishes.
4. If there is no precedent, use a `D<n>` default only when the choice is local
   and can be reversed within one task. Record the reason and reversal cost.
5. Ask the developer when precedents split, the choice affects public behavior
   or contracts, persistent data, security, deployment, multiple tasks, or is
   expensive to reverse.

Enumerate the whole decision set before interviewing. Ask in dependency-frontier
rounds: resolve decisions that block other decisions first, batch only
independent questions, update the ledger after each answer, then advance to the
next newly unblocked round. Do not ask about choices that a single clear
precedent already answers.

Surface contradictions as soon as they appear. Name the conflicting code,
documentation, or reported behavior and ask which desired behavior should win.
Never silently reconcile conflicting evidence.

## Design the work

Build a full use-case tree before producing tasks. Start with each actor or
caller goal, then include successful paths, meaningful variants, failures, and
boundary conditions required by the approved behavior. Mark every branch that an
emitted task covers. Leave excluded branches visible and label them out of
scope.

Turn the marked branches into ordered vertical tasks. Each task must deliver an
observable slice and leave the repository green. Put complete mechanical
prerequisites before the first task that needs them. Do not scatter one
prerequisite across later feature tasks or create horizontal implementation
layers.

Agree the test contract for every task with the developer. Each contract names:

- the public seam under test;
- the behavior the test proves;
- the system boundary that may be faked, if any;
- one deterministic verification command.

Prefer existing public seams. Do not test private implementation details or fake
collaborators owned by the repository. Verification must not require an
installed or authenticated agent harness unless the developer approved that
check.

## Approve and write the plan

Before writing any artifact, present one plan preview containing:

- the goal and approved behavior;
- scope and out-of-scope work;
- user decisions and reasons;
- code-backed assumptions and local defaults;
- the full use-case tree with emitted tasks marked;
- ordered tasks and their test seams.

Obtain explicit approval of that preview. Incorporate requested changes and
present the changed preview again. Do not write plan files before approval.

After approval, read [PLAN-FORMAT.md](PLAN-FORMAT.md) and write its manifest,
planning context, ordered tasks, and empty log. Resolve the target Git root and
run its `node_modules/.bin/striker plan validate <source>`. Stop if the
project-local binary is absent. Correct every validation failure and rerun the
command until it passes.

Finish by naming the plan directory and listing the agreed test seams.
