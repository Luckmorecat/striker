import { parseReviewResult } from "../../runner/review-result.js";
import { agentRequestSchema } from "../run-journal-schema.js";
import type {
  AgentRunner,
  AgentSession,
  AgentTurn,
  GitRepository,
  GitState,
  ReviewTurn,
  VerificationResult,
} from "../../core/contracts.js";
import type { ExecutionServices } from "../../core/execution-environment.js";
import { initialDeliveryPrompt } from "../../runner/task-prompt.js";
import { StageExecutor } from "./stage-executor.js";

function executionRunner(
  executor: StageExecutor,
  skills: readonly string[],
): AgentRunner {
  const runner: AgentRunner = {
    preflight: (request) => {
      if (JSON.stringify(request.skills) !== JSON.stringify(skills))
        throw new Error("Configured skill resources changed after preparation");
      return Promise.resolve();
    },
    runInNewSession: async (request, started) => {
      let session: AgentSession | undefined;
      const turn = (await executor.execute(
        { operation: "implement", request: agentRequestSchema.parse(request) },
        async (value) => {
          session = value;
          await started?.(value);
        },
      )) as AgentTurn;
      if (session?.id !== turn.session.id)
        throw new Error("Worker replaced its recorded session");
      return { ...turn, session };
    },
    resumeSession: async (session, instructions) => {
      const turn = (await executor.execute({
        operation: "continue",
        session,
        instructions,
      })) as AgentTurn;
      if (
        turn.session.id !== session.id ||
        turn.session.resumeId !== session.resumeId
      )
        throw new Error("Worker replaced preserved session");
      return { ...turn, session };
    },
    resumeInitialSession: (session, recovery) =>
      runner.resumeSession(session, initialDeliveryPrompt(recovery)),
    resumeReviewSession: async (session) => {
      const turn = await runner.resumeSession(
        session,
        "Resume the interrupted review using its frozen instructions. Return the required strict review JSON.",
      );
      return turn.status === "failed"
        ? turn
        : {
            status: "returned",
            session,
            result: parseReviewResult(turn.output),
          };
    },
    runReviewInNewSession: async (request, started) => {
      let session: AgentSession | undefined;
      const turn = (await executor.execute(
        { operation: "review", instructions: request.instructions },
        async (value) => {
          session = value;
          await started?.(value);
        },
      )) as ReviewTurn;
      if (session?.id !== turn.session.id)
        throw new Error("Reviewer replaced its recorded session");
      return { ...turn, session };
    },
  };
  return runner;
}

function executionGit(
  executor: StageExecutor,
  projectRoot: string,
): GitRepository {
  const assertRoot = (root: string) => {
    if (root !== projectRoot)
      throw new Error("Worker request names a different execution root");
  };
  const git: GitRepository = {
    inspect: async (root) => {
      assertRoot(root);
      const state = (await executor.execute({
        operation: "inspect",
      })) as GitState;
      return { ...state, root: projectRoot };
    },
    isAncestor: async (root, ancestor, descendant) => {
      assertRoot(root);
      return (await executor.execute({
        operation: "isAncestor",
        ancestor,
        descendant,
      })) as boolean;
    },
    changedPaths: async (root, ancestor, descendant) => {
      assertRoot(root);
      return (await executor.execute({
        operation: "changedPaths",
        ancestor,
        descendant,
      })) as string[];
    },
    commitsBetween: async (root, ancestor, descendant) => {
      assertRoot(root);
      return (await executor.execute({
        operation: "commitsBetween",
        ancestor,
        descendant,
      })) as string[];
    },
    readFileAtCommit: async (root, commit, file) => {
      assertRoot(root);
      return (await executor.execute({
        operation: "readFileAtCommit",
        commit,
        path: file,
      })) as string | null;
    },
    resolveRoot: (root) => {
      assertRoot(root);
      return Promise.resolve(projectRoot);
    },
    resolvePrivatePath: () =>
      Promise.reject(new Error("Worker cannot resolve host private state")),
  };
  return git;
}

export function dockerExecutionServices(
  executor: StageExecutor,
  projectRoot: string,
  skills: readonly string[],
): ExecutionServices {
  return {
    runner: executionRunner(executor, skills),
    git: executionGit(executor, projectRoot),
    verifier: {
      verify: async (request) => {
        if (request.cwd !== projectRoot)
          throw new Error("Worker request names a different execution root");
        const result = (await executor
          .execute({
            operation: "verify",
            command: request.command,
          })
          .catch((error: unknown) => ({
            command: request.command,
            exitCode: 1,
            output: `Verification worker interrupted: ${error instanceof Error ? error.message : String(error)}. Resume the retained run after inspecting its resources.`,
          }))) as VerificationResult;
        if (
          result.exitCode === 137 ||
          /resource temporarily unavailable|cannot allocate memory|no space left/i.test(
            result.output,
          )
        )
          return {
            ...result,
            output: `${result.output}\nIsolated memory, process or storage resources exhausted, or verification was killed. Inspect retained files and recorded limits before recovery.`,
          };
        return result;
      },
    },
  };
}
