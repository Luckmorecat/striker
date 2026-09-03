# Striker

Striker executes approved implementation plans through isolated task sessions
while preserving independently verified evidence across the run.

## Language

**Task Outcome**: A certified, read-only evidence bundle derived from one
completed task for use by relevant later task sessions. _Avoid_: Handoff, agent
instructions

**Outcome Fact**: A bounded factual statement proposed from one task, tied to
exact evidence, and accepted by plan-compliance review before it can enter a
Task Outcome. _Avoid_: Advice, recommendation, instruction

**Outcome Route**: An immutable plan permission for evidence from one source
task to reach a later target task. A reviewed Outcome Fact may select only
targets allowed by its source task's routes. _Avoid_: Dependency, instruction
channel

**Outcome Fact ID**: A task-local `F<n>` identifier that follows an Outcome Fact
through review, journal replay, projection, and delivery.

### Outcome Fact categories

**Public Contract**: Observable behavior on which callers or users may rely.

**Compatibility Constraint**: A condition that must remain true for supported
interoperability or backward compatibility.

**Verified Default**: A concrete fallback or initial choice confirmed by task
evidence.

**Integration Boundary**: A confirmed division of responsibility or interface
between components.
