import type {
  GitRepository,
  GitState,
  ImplementationTask,
  RunAttention,
  TaskExecutionEvidence,
  Verifier,
} from "./contracts.js";

interface EvidenceDependencies {
  readonly git?: GitRepository;
  readonly verifier?: Verifier;
}

interface ReviewedCandidateEvidence {
  readonly changedPaths: readonly string[];
  readonly resultCommit: string;
  readonly startCommit: string;
}

function pathsOverlap(left: string, right: string): boolean {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  );
}

function sameBaseline(before: GitState, after: GitState): boolean {
  return (
    before.trackedPatch === after.trackedPatch &&
    JSON.stringify(before.untrackedHashes) ===
      JSON.stringify(after.untrackedHashes)
  );
}

export async function inspectBaseline(
  dependencies: EvidenceDependencies,
  task: ImplementationTask,
  allowDirty: boolean,
): Promise<GitState | undefined> {
  const execution = task.execution;
  if (execution === undefined) return undefined;
  const git = dependencies.git;
  if (git === undefined)
    throw new Error("Git repository dependency is required");
  const state = await git.inspect(execution.cwd);
  if (state.dirtyPaths.length === 0) return state;
  if (!allowDirty) {
    throw new Error("Repository is dirty; pass --allow-dirty to preserve it");
  }
  const overlap = state.dirtyPaths.find((dirtyPath) =>
    execution.affectedPaths.some((taskPath) =>
      pathsOverlap(dirtyPath, taskPath),
    ),
  );
  if (overlap !== undefined)
    throw new Error(`Task overlaps dirty path: ${overlap}`);
  return state;
}

export async function collectExecutionEvidence(
  dependencies: EvidenceDependencies,
  task: ImplementationTask,
  before: GitState | undefined,
): Promise<TaskExecutionEvidence | undefined> {
  if (task.execution === undefined || before === undefined) return undefined;
  const { git, verifier } = dependencies;
  if (git === undefined || verifier === undefined) {
    throw new Error("Git and verifier dependencies are required");
  }
  const verification = await verifier.verify({
    command: task.execution.verifyCommand,
    cwd: task.execution.cwd,
  });
  const after = await git.inspect(task.execution.cwd);
  const commits = await git.commitsBetween(
    task.execution.cwd,
    before.head,
    after.head,
  );
  const changedPaths = await git.changedPaths(
    task.execution.cwd,
    before.head,
    after.head,
  );
  return { after, before, changedPaths, commits, verification };
}

export function executionAttention(
  evidence: TaskExecutionEvidence | undefined,
): RunAttention | null {
  if (evidence === undefined) return null;
  if (evidence.verification.exitCode !== 0) {
    return {
      detail: [
        `Verification exited with code ${String(evidence.verification.exitCode)}.`,
        evidence.verification.output.slice(0, 2_000),
      ].join("\n"),
      reason: "verification_failed",
    };
  }
  if (evidence.commits.length !== 1) {
    return {
      detail: `Expected one task commit; found ${String(evidence.commits.length)}.`,
      reason: "commit_evidence_missing",
    };
  }
  if (!sameBaseline(evidence.before, evidence.after)) {
    return {
      detail: "The final worktree differs from the preserved dirty baseline.",
      reason: "dirty_final_state",
    };
  }
  return null;
}

export async function reviewedCandidateAttention(
  dependencies: EvidenceDependencies,
  task: ImplementationTask,
  before: GitState,
  review: ReviewedCandidateEvidence,
): Promise<RunAttention | null> {
  const execution = task.execution;
  const git = dependencies.git;
  if (execution === undefined || git === undefined) {
    throw new Error("Git execution context is required for reviewed candidate");
  }
  const after = await git.inspect(execution.cwd);
  const commits = await git.commitsBetween(
    execution.cwd,
    before.head,
    after.head,
  );
  const changedPaths = await git.changedPaths(
    execution.cwd,
    before.head,
    after.head,
  );
  if (
    before.head !== review.startCommit ||
    after.head !== review.resultCommit ||
    commits.length !== 1 ||
    commits[0] !== review.resultCommit ||
    JSON.stringify(changedPaths) !== JSON.stringify(review.changedPaths)
  ) {
    return {
      detail: "The checkout no longer matches the reviewed commit evidence.",
      reason: "commit_evidence_missing",
    };
  }
  if (before.root !== after.root || !sameBaseline(before, after)) {
    return {
      detail: "The checkout no longer matches the reviewed dirty baseline.",
      reason: "dirty_final_state",
    };
  }
  return null;
}
