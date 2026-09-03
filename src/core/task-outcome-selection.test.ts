import { expect, it } from "vitest";

import type { GitRepository, TaskOutcome } from "./contracts.js";
import { selectTaskOutcomeEvidence } from "./task-outcome-selection.js";

const source = { id: "tasks/01.md", revision: "source-revision" };
const target = { id: "tasks/03.md", revision: "target-revision" };

function outcome(overrides: Partial<TaskOutcome> = {}): TaskOutcome {
  return {
    attempt: 1,
    changedPaths: ["src/outcome.ts"],
    facts: [
      {
        category: "public_contract",
        evidence: {
          commit: "source-commit",
          kind: "code",
          line: 12,
          path: "src/outcome.ts",
          text: "export function selectTaskOutcomeEvidence()",
        },
        id: "F2",
        relevantTo: [target],
        statement: "Selection is deterministic.",
      },
    ],
    resultCommit: "source-commit",
    runId: "source-run",
    source,
    transitions: [
      {
        id: "A1",
        kind: "assumption",
        relevantTo: [target],
        state: "confirmed",
      },
    ],
    verification: { command: "pnpm check", exitCode: 0 },
    ...overrides,
  };
}

function repository(isAncestor = true): GitRepository {
  return {
    changedPaths: () => Promise.resolve([]),
    commitsBetween: () => Promise.resolve([]),
    inspect: () => {
      throw new Error("Selection must use the supplied execution state");
    },
    isAncestor: () => Promise.resolve(isAncestor),
    resolvePrivatePath: () => Promise.resolve("/repo/.git/striker"),
    resolveRoot: () => Promise.resolve("/repo"),
  };
}

it("delivers only routed entries in manifest and numeric ID order", async () => {
  const duplicate = outcome();
  const duplicateFact = duplicate.facts[0];
  if (duplicateFact === undefined) throw new Error("Missing fact fixture");
  const earlier = outcome({
    facts: [
      {
        ...duplicateFact,
        id: "F1",
        statement: "Earlier numeric IDs are delivered first.",
      },
      duplicateFact,
    ],
  });

  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes: [earlier, duplicate],
      planId: "plan-1",
      routes: [{ from: source, to: [target] }],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, { id: "tasks/02.md", revision: "middle" }, target],
    }),
  ).resolves.toEqual({
    evidence: [
      {
        changedPaths: ["src/outcome.ts"],
        facts: [
          {
            category: "public_contract",
            evidence: {
              commit: "source-commit",
              kind: "code",
              line: 12,
              path: "src/outcome.ts",
              text: "export function selectTaskOutcomeEvidence()",
            },
            id: "F1",
            statement: "Earlier numeric IDs are delivered first.",
          },
          {
            category: "public_contract",
            evidence: {
              commit: "source-commit",
              kind: "code",
              line: 12,
              path: "src/outcome.ts",
              text: "export function selectTaskOutcomeEvidence()",
            },
            id: "F2",
            statement: "Selection is deterministic.",
          },
        ],
        resultCommit: "source-commit",
        source,
        transitions: [{ id: "A1", kind: "assumption", state: "confirmed" }],
        verification: { command: "pnpm check", exitCode: 0 },
      },
    ],
    status: "selected",
  });
});

it.each([
  {
    name: "plan identity",
    overrides: { journalPlanId: "other-plan" },
  },
  {
    name: "target identity",
    overrides: {
      target: { id: target.id, revision: "changed-target" },
    },
  },
  {
    name: "source identity",
    overrides: {
      outcomes: [
        outcome({
          source: { id: source.id, revision: "changed-source" },
        }),
      ],
    },
  },
])("fails closed on a conflicting $name", async ({ overrides }) => {
  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes: [outcome()],
      planId: "plan-1",
      routes: [{ from: source, to: [target] }],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, target],
      ...overrides,
    }),
  ).resolves.toMatchObject({ status: "conflict" });
});

it("fails closed when a source result is not an execution ancestor", async () => {
  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(false),
      journalPlanId: "plan-1",
      outcomes: [outcome()],
      planId: "plan-1",
      routes: [{ from: source, to: [target] }],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, target],
    }),
  ).resolves.toEqual({
    detail:
      "Task Outcome result commit is not an execution ancestor: source-commit",
    status: "conflict",
  });
});

it("fails closed instead of truncating aggregate evidence", async () => {
  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes: [outcome({ changedPaths: [`src/${"x".repeat(17_000)}.ts`] })],
      planId: "plan-1",
      routes: [{ from: source, to: [target] }],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, target],
    }),
  ).resolves.toMatchObject({ status: "limit_exceeded" });
});

it("enforces the aggregate sixteen-fact limit after deduplication", async () => {
  const baseFact = outcome().facts[0];
  if (baseFact === undefined) throw new Error("Missing fact fixture");
  const sources = [1, 2, 3].map((index) => ({
    id: `tasks/source-${String(index)}.md`,
    revision: `source-${String(index)}`,
  }));
  const outcomes = sources.map((currentSource, sourceIndex) => {
    const factCount = sourceIndex === 2 ? 5 : 6;
    return outcome({
      facts: Array.from({ length: factCount }, (_, index) => ({
        ...baseFact,
        id: `F${String(index + 1)}`,
        relevantTo: [target],
      })),
      resultCommit: `commit-${String(sourceIndex + 1)}`,
      source: currentSource,
      transitions: [],
    });
  });

  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes,
      planId: "plan-1",
      routes: sources.map((currentSource) => ({
        from: currentSource,
        to: [target],
      })),
      target,
      taskPlanId: "plan-1",
      taskOrder: [...sources, target],
    }),
  ).resolves.toMatchObject({ status: "limit_exceeded" });
});

it("rejects a later target that is absent from the immutable route", async () => {
  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes: [outcome()],
      planId: "plan-1",
      routes: [],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, target],
    }),
  ).resolves.toEqual({
    detail: "Task Outcome route is not authorized: tasks/01.md -> tasks/03.md",
    status: "conflict",
  });
});

it("rejects a transition that omits an authorized route target", async () => {
  const laterTarget = { id: "tasks/04.md", revision: "later-revision" };
  await expect(
    selectTaskOutcomeEvidence({
      execution: { head: "execution-head", root: "/repo" },
      git: repository(),
      journalPlanId: "plan-1",
      outcomes: [outcome()],
      planId: "plan-1",
      routes: [{ from: source, to: [target, laterTarget] }],
      target,
      taskPlanId: "plan-1",
      taskOrder: [source, target, laterTarget],
    }),
  ).resolves.toEqual({
    detail: "Task Outcome transition route is incomplete: tasks/01.md -> A1",
    status: "conflict",
  });
});

it("orders arbitrarily large entry suffixes numerically", async () => {
  const baseFact = outcome().facts[0];
  if (baseFact === undefined) throw new Error("Missing fact fixture");
  const selected = await selectTaskOutcomeEvidence({
    execution: { head: "execution-head", root: "/repo" },
    git: repository(),
    journalPlanId: "plan-1",
    outcomes: [
      outcome({
        facts: [
          { ...baseFact, id: "F1000000000000000000000" },
          { ...baseFact, id: "F999999999999999999999" },
        ],
      }),
    ],
    planId: "plan-1",
    routes: [{ from: source, to: [target] }],
    target,
    taskPlanId: "plan-1",
    taskOrder: [source, target],
  });

  expect(selected).toMatchObject({
    evidence: [
      {
        facts: [
          { id: "F999999999999999999999" },
          { id: "F1000000000000000000000" },
        ],
      },
    ],
    status: "selected",
  });
});
