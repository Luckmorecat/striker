# Evidence for repository instructions

Reviewed 2026-11-07. Research window: 2026-05-07 through 2026-11-07. The studies
below do not establish a universally optimal AGENTS.md format. Use them to limit
claims, not to delete required project rules.

## Controlled task evaluations

- **Gloaguen et al., Evaluating AGENTS.md**
  ([September 29 revision](https://arxiv.org/html/2602.11988v3)). The original
  February publication is outside this window; this summary uses the revised
  version. Evaluated 300 SWE-bench Lite and 138 CTXbench tasks across four agent
  configurations. Context files did not generally improve task success and
  increased mean inference cost by more than 20%. File length had no clear
  relationship with success. The result concerns these tasks and configurations,
  not every instruction or repository. It supports measuring net benefit rather
  than assuming that adding context helps; it does not prove shorter is better.
- **Khatri, Do Context Files Help Coding Agents?**
  ([REALM, October 2026](https://aclanthology.org/2026.realm-1.5/)). Compared no
  context, always-on context, and selective context across 288 runs, 17 tasks,
  three Python repositories, and Claude Code/Codex. No measurable correctness
  benefit was found within the study; equivalence bounds were 10–15 percentage
  points. Selective context was content-matched in only one repository. This is
  bounded evidence, not proof of zero effect or of skills outperforming
  AGENTS.md.

## Narrow adherence experiment

- **McMillan, Instruction Adherence in Coding Agent Configuration Files**
  ([May 11, 2026](https://arxiv.org/abs/2605.10039)). Ran 1,650 Claude Code
  sessions in two TypeScript codebases. Corrected comparisons found no
  detectable differences for tested size, position, file architecture, and
  adjacent contradiction conditions. The outcome was a simple annotation
  requirement, not full engineering correctness. Do not infer that nesting or
  brevity improves compliance, or that contradictions are safe.

## Observational evidence

- **Santos et al., Configuration Smells in AGENTS.md Files**
  ([June 2026](https://arxiv.org/abs/2606.15828)). Examined 100 repositories
  using heuristics and manual review. Its categories include excessive context,
  duplicated rules, stale content, unclear references, and contradictions. These
  are audit prompts, not experimentally proven causes of failure. A heuristic
  length threshold is not an optimal size recommendation.

## Applying the evidence

Clear triggers, verified references, one maintained owner per rule, and scoped
instructions are maintainability choices. Their performance benefit must be
checked locally. Preserve useful project-specific requirements even when a study
reports no average benefit from context files.

For stronger local evidence, choose tasks and scoring before trials, include
unseen tasks, keep the environment fixed, and compare multiple fresh runs.
Report the sample size and separate task correctness from adherence and cost. Do
not turn a favorable anecdote or an inconclusive result into a universal rule.
