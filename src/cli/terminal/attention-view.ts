import type { RecoveryInspection } from "../../core/recovery-operations.js";

/** What the paused run is asking, as the operator-facing question. */
export function attentionQuestion(context: RecoveryInspection): string {
  return (
    context.attention?.detail ?? `State: ${context.status.replaceAll("_", " ")}`
  );
}

export function attentionView(context: RecoveryInspection): string {
  const lines = [`Run ${context.runId}`];
  if (context.task !== null)
    lines.push(`Task ${context.task.identity.id}: ${context.task.title}`);
  if (context.attention !== null) {
    lines.push(
      `Reason: ${context.attention.reason.replaceAll("_", " ")}`,
      context.attention.detail,
    );
  } else lines.push(`State: ${context.status.replaceAll("_", " ")}`);
  return `${lines.join("\n")}\n\n`;
}
