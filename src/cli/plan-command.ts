import type { Command } from "commander";

import type {
  PlanQueryHandler,
  PlanStatus,
  PlanValidator,
} from "../core/contracts.js";

export interface PlanCommandDependencies {
  readonly queryHandler?: PlanQueryHandler;
  readonly validator: PlanValidator;
  readonly writeOut: (text: string) => void;
}

function renderLedger(
  label: string,
  entries: PlanStatus["assumptions"],
): readonly string[] {
  return [
    `${label}:`,
    ...(entries.length === 0
      ? ["- none"]
      : entries.flatMap((entry) => {
          const locator = entry.locator;
          const evidence =
            locator?.kind === "code"
              ? `${locator.path}:${String(locator.line)} at ${locator.commit}`
              : locator === undefined
                ? undefined
                : `${locator.command} exited ${String(locator.exitCode)}`;
          return [
            `- ${entry.id}: ${entry.state}: ${entry.statement}`,
            ...(entry.proposal === undefined
              ? []
              : [`  Proposal: ${entry.proposal}`]),
            ...(entry.reason === undefined
              ? []
              : [`  Review: ${entry.decision ?? "unknown"}. ${entry.reason}`]),
            ...(entry.applied === undefined
              ? []
              : [`  Transition: ${entry.applied ? "applied" : "not applied"}`]),
            ...(entry.pauseReason === undefined
              ? []
              : [`  Pause: ${entry.pauseReason}`]),
            ...(evidence === undefined ? [] : [`  Evidence: ${evidence}`]),
          ];
        })),
  ];
}

function renderReviews(reviews: PlanStatus["reviews"]): readonly string[] {
  return [
    "Reviews:",
    ...(reviews.length === 0
      ? ["- none"]
      : reviews.map(
          (review) =>
            `- ${review.task.id}@${review.task.revision}: standards ${review.standards}, plan ${review.plan}`,
        )),
  ];
}

function renderStatus(status: PlanStatus): string {
  const lines = [
    `Plan: ${status.planId}`,
    `Status: ${status.status}`,
    "Tasks:",
    ...status.tasks.map(
      (task) => `- ${task.id}@${task.revision}: ${task.state}`,
    ),
    `Active run: ${status.activeRun?.runId ?? "none"}`,
    `Attempt: ${String(status.activeRun?.attempt ?? "none")}`,
    `Attention: ${
      status.attention === null
        ? "none"
        : `${status.attention.reason}: ${status.attention.detail}`
    }`,
    ...renderReviews(status.reviews),
    ...renderLedger("Assumptions", status.assumptions),
    ...renderLedger("Defaults", status.defaults),
  ];
  return `${lines.join("\n")}\n`;
}

export function addPlanCommand(
  program: Command,
  dependencies: PlanCommandDependencies,
): void {
  const plan = program.command("plan").description("Work with Striker plans");
  plan
    .command("validate")
    .description("Validate a versioned Striker plan")
    .argument("<source>", "plan directory")
    .action(async (source: string) => {
      const result = await dependencies.validator.validate(source);
      const noun = result.taskCount === 1 ? "task" : "tasks";
      dependencies.writeOut(
        `Valid Striker plan: ${String(result.taskCount)} ${noun}\n`,
      );
    });
  if (dependencies.queryHandler === undefined) return;
  const queryHandler = dependencies.queryHandler;
  plan
    .command("status")
    .description("Report persistent plan state")
    .argument("<source>", "plan directory")
    .action(async (source: string) => {
      dependencies.writeOut(renderStatus(await queryHandler.status(source)));
    });
  plan
    .command("log")
    .description("Print persistent plan history")
    .argument("<source>", "plan directory")
    .action(async (source: string) => {
      dependencies.writeOut(await queryHandler.log(source));
    });
}
