import type { RecoveryInspection } from "../../core/recovery-operations.js";

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
