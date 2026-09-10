import type {
  RecoveryCommandHandler,
  RunCommandResult,
} from "../core/contracts.js";
import type {
  RecoveryInspection,
  RecoveryInspector,
  RecoveryOperationHandler,
} from "../core/recovery-operations.js";
import type { RecoveryAction } from "../core/recovery-policy.js";
import type { AnswerReader } from "./answer-command.js";
import { AnswerCancelled } from "./input-cancelled.js";

export type RecoveryChoice = RecoveryAction | { readonly exitCode: 0 | 130 };
export interface RecoveryInteraction {
  readonly interactive: boolean;
  setEnabled(enabled: boolean): void;
  choose(context: RecoveryInspection): Promise<RecoveryChoice>;
}
export interface InteractionOptions {
  readonly interactive?: boolean;
  readonly file?: string;
}
export interface CommandInteraction {
  prepare(options: InteractionOptions): void;
  finish(result: RunCommandResult, follow?: boolean): Promise<void>;
}
interface Dependencies {
  readonly interaction?: RecoveryInteraction;
  readonly recoveryInspector?: RecoveryInspector;
  readonly recoveryHandler?: RecoveryCommandHandler;
  readonly operationHandler?: RecoveryOperationHandler;
  readonly answerReader?: AnswerReader;
  readonly stdout: { write(text: string): unknown };
}

export function recoveryGuidance(context: RecoveryInspection): string {
  const actions = Object.entries(context.availability)
    .filter(([, blocker]) => blocker === null)
    .map(([action]) => `striker ${action}`);
  if (actions.length > 0) return `Available recovery: ${actions.join(", ")}.`;
  return `${Object.values(context.availability).filter(Boolean).join(". ")}. Inspect with striker status; leave paused or explicitly discard with striker discard --force.`;
}

export class InteractiveController implements CommandInteraction {
  private enabled = false;
  constructor(private readonly dependencies: Dependencies) {}

  prepare(options: InteractionOptions): void {
    const { interaction } = this.dependencies;
    interaction?.setEnabled(options.interactive !== false);
    this.enabled =
      options.interactive !== false &&
      interaction?.interactive === true &&
      options.file === undefined;
  }

  async finish(initial: RunCommandResult, follow = true): Promise<void> {
    let result = initial;
    while (result.status === "needs_attention") {
      const context =
        await this.dependencies.recoveryInspector?.inspectRecovery();
      if (context == null) throw new Error(result.message);
      if (!this.enabled || !follow)
        throw new Error(`${result.message}\n${recoveryGuidance(context)}`);
      result = await this.continue(context);
    }
    if (result.status !== "completed") {
      const context =
        await this.dependencies.recoveryInspector?.inspectRecovery();
      throw new Error(
        context == null
          ? result.message
          : `${result.message}\n${recoveryGuidance(context)}`,
      );
    }
    this.dependencies.stdout.write(`${result.message}\n`);
  }

  private async continue(
    context: RecoveryInspection,
  ): Promise<RunCommandResult> {
    const { recoveryHandler, operationHandler } = this.dependencies;
    const action = await this.choose(context);
    if (typeof action !== "string") throw new AnswerCancelled(action.exitCode);
    if (context.availability[action] !== null)
      throw new Error(context.availability[action]);
    if (action === "retry" && operationHandler !== undefined)
      return operationHandler.retry();
    if (action === "resume" && recoveryHandler !== undefined)
      return recoveryHandler.resume();
    if (action === "answer") return this.answer(context);
    throw new Error(`Recovery handler unavailable: ${action}`);
  }

  private choose(context: RecoveryInspection): Promise<RecoveryChoice> {
    const { interaction } = this.dependencies;
    if (interaction === undefined)
      throw new Error("Interactive terminal unavailable");
    const reason = context.attention?.reason;
    if (
      (reason === "assumption_needs_decision" ||
        reason === "assumption_disproved") &&
      context.availability.answer === null
    )
      return Promise.resolve("answer");
    return interaction.choose(context);
  }

  private async answer(context: RecoveryInspection): Promise<RunCommandResult> {
    const { recoveryHandler, answerReader } = this.dependencies;
    if (recoveryHandler === undefined || answerReader === undefined)
      throw new Error("Answer handler unavailable");
    const input = await answerReader.read(undefined, context);
    if (typeof input !== "string" && input.status === "cancelled")
      throw new AnswerCancelled(input.exitCode);
    return recoveryHandler.answer(
      typeof input === "string" ? input : input.text,
    );
  }
}
