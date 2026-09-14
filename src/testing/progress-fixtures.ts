import type { RunJournalEvent } from "../core/contracts.js";
import type { RunObservation } from "../core/run-observation.js";
import {
  applyObservation,
  dashboardModel,
  initialProgress,
  type DashboardModel,
} from "../cli/ui/progress-model.js";

export const progressPlan = {
  tasks: [
    { id: "01", title: "Recovery contracts" },
    { id: "02", title: "Answer command" },
  ],
};

export const progressTask = {
  identity: { id: "02", revision: "r1" },
  instructions: "Implement the answer command.",
  title: "Answer command",
};
export const progressSession = { id: "session-42" };
export const progressVerification = {
  command: "pnpm check",
  exitCode: 0,
  output: "ok",
};

export function journal(event: RunJournalEvent): RunObservation {
  return { event, kind: "journal" };
}

export const runStarted = journal({
  planId: "plan",
  request: {
    completedTasks: [],
    planId: "plan",
    runId: "run",
    skills: [],
    taskSource: { location: "/plan", type: "striker" },
  },
  runId: "run",
  type: "run_started",
});
export const taskSelected = journal({
  runId: "run",
  task: progressTask,
  type: "task_selected",
});
export const attemptStarted = journal({
  attempt: 1,
  runId: "run",
  task: progressTask.identity,
  type: "task_attempt_started",
});
export const sessionStarted = journal({
  attempt: 1,
  request: { instructions: "go", skills: [] },
  runId: "run",
  session: progressSession,
  task: progressTask.identity,
  type: "task_session_started",
});
export const implementing = [
  runStarted,
  taskSelected,
  attemptStarted,
  sessionStarted,
];

export const taskCertified = journal({
  attempt: 1,
  certification: "independent_reviews",
  changedPaths: ["src/a.ts"],
  completedAt: "2026-09-12T00:00:00.000Z",
  resultCommit: "candidate-b",
  runId: "run",
  session: progressSession,
  startCommit: "base",
  task: progressTask.identity,
  type: "task_completed",
  verification: progressVerification,
});

export function blockingFinding(message: string) {
  return {
    fix: "fix it",
    kind: "rule_violation" as const,
    location: { line: 1 },
    message,
    path: "src/a.ts",
    rule: "rule",
    severity: "blocking" as const,
  };
}

export const blockingResult = {
  findings: [
    blockingFinding("Input consumed before eligibility is checked"),
    blockingFinding("Cancelled input incorrectly resumes the session"),
  ],
  kind: "standards" as const,
  resultCommit: "candidate-a",
  startCommit: "base",
  verdict: "changes_required" as const,
};

export const passedOnB = {
  findings: [],
  kind: "standards" as const,
  resultCommit: "candidate-b",
  startCommit: "base",
  verdict: "passed" as const,
};

export function reviewStarted(resultCommit: string): RunObservation {
  return journal({
    attempt: 1,
    changedPaths: ["src/a.ts"],
    completion: { summary: "done" },
    resultCommit,
    runId: "run",
    session: progressSession,
    startCommit: "base",
    task: progressTask.identity,
    type: "standards_review_started",
    verification: progressVerification,
  });
}

export function reviewCompleted(
  result: typeof blockingResult | typeof passedOnB,
): RunObservation {
  return journal({
    result,
    runId: "run",
    session: progressSession,
    task: progressTask.identity,
    type: "standards_review_completed",
  });
}

export function repairStarted(result: typeof blockingResult): RunObservation {
  return journal({
    result,
    runId: "run",
    session: progressSession,
    task: progressTask.identity,
    type: "standards_repair_started",
  });
}

export function progressDashboard(
  ...observations: readonly RunObservation[]
): DashboardModel {
  return dashboardModel(
    observations.reduce(
      applyObservation,
      initialProgress({ backend: "docker", plan: progressPlan }),
    ),
  );
}

export function stageStates(dashboard: DashboardModel): Record<string, string> {
  return Object.fromEntries(
    dashboard.pipeline.map((entry) => [entry.stage, entry.state]),
  );
}

export const verifying: RunObservation = {
  command: "pnpm check",
  kind: "verification",
  phase: "started",
};
export const verified: RunObservation = {
  command: "pnpm check",
  exitCode: 0,
  kind: "verification",
  phase: "finished",
};
export const blockedRun = [
  ...implementing,
  verifying,
  verified,
  reviewStarted("candidate-a"),
  reviewCompleted(blockingResult),
];

export const attentionObservation = journal({
  attention: {
    detail: "Should blank answers reprompt, or leave the run paused?",
    reason: "assumption_needs_decision",
  },
  runId: "run",
  session: progressSession,
  task: progressTask.identity,
  type: "run_needs_attention",
});

const answered = journal({
  answer: "Reprompt on blank answers.",
  runId: "run",
  session: progressSession,
  task: progressTask.identity,
  type: "run_answered",
});

const planReview = journal({
  attempt: 1,
  changedPaths: ["src/a.ts"],
  completion: { summary: "done" },
  resultCommit: "candidate-b",
  runId: "run",
  session: progressSession,
  standards: passedOnB,
  startCommit: "base",
  task: progressTask.identity,
  type: "plan_compliance_review_started",
  verification: progressVerification,
});

const certified = journal({
  attempt: 1,
  certification: "independent_reviews",
  changedPaths: ["src/a.ts"],
  completedAt: "2026-09-12T00:00:00.000Z",
  resultCommit: "candidate-b",
  runId: "run",
  session: progressSession,
  startCommit: "base",
  task: progressTask.identity,
  type: "task_completed",
  verification: progressVerification,
});

const note = (text: string): RunObservation => ({
  activity: "note",
  kind: "activity",
  text,
});
const tool = (text: string): RunObservation => ({
  activity: "tool",
  kind: "activity",
  text,
});

/** The earlier task the reference plan panel shows as already certified. */
const firstTaskCertified = journal({
  attempt: 1,
  certification: "independent_reviews",
  changedPaths: ["src/recovery.ts"],
  completedAt: "2026-09-12T00:00:00.000Z",
  resultCommit: "candidate-0",
  runId: "run",
  session: { id: "session-41" },
  startCommit: "base",
  task: { id: "01", revision: "r1" },
  type: "task_completed",
  verification: progressVerification,
});

/** The approved reference timeline as authoritative facts, one step per entry. */
export const previewScenario: readonly RunObservation[] = [
  {
    detail: "Opening the retained workspace.",
    kind: "preparation",
    phase: "started",
  },
  firstTaskCertified,
  ...implementing,
  note("Checking answer eligibility before input."),
  tool("Read recovery-policy.ts"),
  attentionObservation,
  answered,
  note("Applying your decision to the answer editor."),
  tool("Edit answer-command.ts"),
  verifying,
  verified,
  reviewStarted("candidate-a"),
  reviewCompleted(blockingResult),
  repairStarted(blockingResult),
  note("Fixing 2 blocking review findings."),
  tool("Edit answer-command.ts"),
  verifying,
  verified,
  reviewStarted("candidate-b"),
  reviewCompleted(passedOnB),
  planReview,
  journal({
    result: {
      discoveryDecisions: [],
      findings: [],
      kind: "plan_compliance",
      outcomeFactDecisions: [],
      resultCommit: "candidate-b",
      startCommit: "base",
      verdict: "passed",
    },
    runId: "run",
    session: progressSession,
    task: progressTask.identity,
    type: "plan_compliance_review_completed",
  }),
  certified,
  journal({ runId: "run", type: "run_completed" }),
];

export const previewPlan = {
  tasks: [
    "Recovery contracts",
    "Answer command",
    "Terminal handoff",
    "Recovery guidance",
    "Documentation",
  ].map((title, index) => ({
    id: String(index + 1).padStart(2, "0"),
    title,
  })),
};
