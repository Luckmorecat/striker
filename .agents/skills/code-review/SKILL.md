---
name: code-review
description: Review changes since a fixed point against repository standards and an optional approved plan. Use for branch, pull-request, work-in-progress, or post-implementation review, including requests to review since a commit, branch, tag, or merge base.
---

# Code review

Review a pinned change along two independent axes:

- Standards: conformance to repository rules and the smell baseline.
- Plan compliance: conformance to the approved plan plus current task. The task sets immediate scope; the plan remains its boundary.

Use only the work contract supplied to the review. If none exists, skip Plan compliance and report `No plan available; axis skipped.`

## 1. Pin the change

Require a fixed point. Accept the starting `HEAD` from `$implement`; otherwise ask for a commit, branch, tag, or merge base. Resolve it with `git rev-parse` and require a non-empty review target.

Review committed changes with `git diff <fixed-point>...HEAD` and `git log <fixed-point>..HEAD --oneline`. Add staged, unstaged, and untracked changes. When `$implement` supplies an initial dirty snapshot, exclude matching pre-existing changes. Stop if new work overlaps them and cannot be separated safely.

## 2. Collect standards

Find repository guidance that applies to the changed files, including coding standards, contribution docs, and agent or rule files. Report only problems introduced by the review target, not unchanged code shown as context. Repository rules override this baseline. Skip checks already enforced by tooling.

Treat these smells as advisory unless one exposes a concrete defect: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man, Refused Bequest.

## 3. Run isolated reviews

Spawn both sub-agents in parallel. If no work contract exists, spawn only Standards.

Give Standards the exact review target, commit list, applicable rule files, and smell baseline. Ask for every documented-rule breach and material smell. A mandatory rule breach is blocking; a smell is advisory unless it proves a defect.

Give Plan compliance the exact review target and full work contract. Ask for missing or partial requirements, incorrect behavior, scope creep, and task-plan conflicts. Every confirmed finding is blocking.

Each finding must contain severity, file and line, violated rule or plan clause, and a short fix. Return findings only, under 300 words per axis. Omit praise and unchanged requirements.

## 4. Report

Keep the reports separate under `## Standards` and `## Plan compliance`. Lightly clean them without merging or reranking findings. End with finding counts for each axis.
