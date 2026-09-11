import type {
  ImplementationTask,
  RunJournal,
  RunJournalEvent,
} from "../../core/contracts.js";
import type { ExecutionServices } from "../../core/execution-environment.js";
import type { RunHistoryReader } from "../../core/run-history.js";
import type { RunObserver } from "../../core/run-observation.js";
import { observedRunJournal } from "../../infrastructure/observed-run-journal.js";
import type { TerminalSession } from "../terminal/terminal-session.js";
import { createRunObservations, observedVerifier } from "./progress-events.js";
import type { PlanTaskSeed } from "./progress-model.js";
import { intervalClock, ProgressSession } from "./progress-session.js";

/** Seeds the plan panel from a parsed source without a second plan authority. */
export function planPanelSeed(tasks: readonly ImplementationTask[]): {
  readonly tasks: readonly PlanTaskSeed[];
} {
  return {
    tasks: tasks.map((task) => ({ id: task.identity.id, title: task.title })),
  };
}

/** Recovery seeds display from journal facts, plus the plan when it parses. */
export async function recoveryProgressContext(options: {
  readonly backend: "docker" | "local";
  readonly history: RunHistoryReader;
  readonly location: string | undefined;
  readonly parsePlan: (
    location: string,
  ) => Promise<{ readonly tasks: readonly ImplementationTask[] }>;
}): Promise<RunProgressContext> {
  const history = await options.history.readActive();
  let plan;
  try {
    if (options.location !== undefined)
      plan = planPanelSeed((await options.parsePlan(options.location)).tasks);
  } catch {
    // A moved or edited plan source still leaves the journal facts truthful.
  }
  return {
    backend: options.backend,
    ...(history === null ? {} : { history: history.events }),
    ...(plan === undefined ? {} : { plan }),
  };
}

/** Preparation failures stay visible instead of inventing a green stage. */
export async function openWithProgress<T>(
  progress: RunProgress | undefined,
  open: () => Promise<T>,
): Promise<T> {
  try {
    const opened = await open();
    progress?.prepared("Execution environment ready.");
    return opened;
  } catch (error) {
    progress?.preparationFailed(
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export interface RunProgressContext {
  readonly backend: "docker" | "local";
  readonly history?: readonly RunJournalEvent[];
  readonly plan?: { readonly tasks: readonly PlanTaskSeed[] };
}

/**
 * One command's display composition: a typed publisher, the observers that
 * feed it, and the terminal turn the dashboard and prompts share.
 */
export class RunProgress {
  readonly #observations = createRunObservations();
  #session: ProgressSession | null = null;
  #startedAt = Date.now();

  constructor(
    private readonly terminal: TerminalSession,
    private readonly onInterrupt?: () => void,
  ) {}

  get observer(): RunObserver {
    return this.#observations;
  }

  begin(context: RunProgressContext): void {
    this.end();
    this.#startedAt = Date.now();
    this.#session = ProgressSession.start({
      clock: intervalClock(),
      elapsed: () => Math.floor((Date.now() - this.#startedAt) / 1000),
      ...(context.history === undefined ? {} : { history: context.history }),
      observations: this.#observations,
      ...(this.onInterrupt === undefined
        ? {}
        : { onInterrupt: this.onInterrupt }),
      seed: {
        backend: context.backend,
        ...(context.plan === undefined ? {} : { plan: context.plan }),
      },
      terminal: this.terminal,
    });
  }

  /** A plan parsed after begin fills the panel of the display already owned. */
  plan(tasks: readonly ImplementationTask[]): void {
    this.#session?.plan(planPanelSeed(tasks).tasks);
  }

  preparing(detail: string): void {
    this.#observations.observe({
      detail,
      kind: "preparation",
      phase: "started",
    });
  }

  prepared(detail: string): void {
    this.#observations.observe({ detail, kind: "preparation", phase: "ready" });
  }

  preparationFailed(detail: string): void {
    this.#observations.observe({
      detail,
      kind: "preparation",
      phase: "failed",
    });
  }

  journal(journal: RunJournal): RunJournal {
    return observedRunJournal(journal, this.#observations);
  }

  services(services: ExecutionServices): ExecutionServices {
    return {
      ...services,
      verifier: observedVerifier(services.verifier, this.#observations),
    };
  }

  /** Prompts take exclusive keyboard ownership below the retained dashboard. */
  async prompt<T>(run: () => Promise<T>): Promise<T> {
    this.#session?.suspend();
    try {
      return await run();
    } finally {
      this.#session?.resume();
    }
  }

  /** Owns one command's display lifetime, including its failure paths. */
  async run<T>(
    context: RunProgressContext,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.begin(context);
    try {
      return await operation();
    } finally {
      this.end();
    }
  }

  end(): void {
    this.#session?.dispose();
    this.#session = null;
  }

  close(): void {
    this.end();
    this.#observations.close();
  }
}
