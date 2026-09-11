import { z } from "zod";

import {
  planComplianceReviewResultSchema,
  standardsReviewResultSchema,
} from "../review-result-schema.js";

interface ReviewSchemaInputs {
  readonly agentSession: z.ZodType;
  readonly completion: z.ZodType;
  readonly discoveries: z.ZodType;
  readonly outcomeFacts: z.ZodType;
  readonly runAttention: z.ZodType;
  readonly taskIdentity: z.ZodType;
  readonly verification: z.ZodType;
}

const reviewStageSchema = z.enum([
  "changes_required",
  "interrupted",
  "passed",
  "repaired",
  "repair_attention",
  "repair_interrupted",
  "repairing",
  "reviewing",
]);

function reviewState(
  input: ReviewSchemaInputs,
  result: z.ZodType,
  extra: Readonly<Record<string, z.ZodType>> = {},
) {
  return z
    .object({
      attempt: z.number().int().positive(),
      changedPaths: z.array(z.string()),
      completion: input.completion,
      result: result.nullable(),
      resultCommit: z.string().min(1),
      repairOutput: z.string().nullable(),
      repairSession: input.agentSession.optional(),
      reviewSession: input.agentSession.nullable(),
      stage: reviewStageSchema,
      startCommit: z.string().min(1),
      verification: input.verification,
      ...extra,
    })
    .strict();
}

function reviewStarted(
  input: ReviewSchemaInputs,
  type: "plan_compliance_review_started" | "standards_review_started",
  extra: Readonly<Record<string, z.ZodType>> = {},
) {
  return z
    .object({
      attempt: z.number().int().positive(),
      changedPaths: z.array(z.string()),
      completion: input.completion,
      resultCommit: z.string().min(1),
      runId: z.string().min(1),
      session: input.agentSession,
      startCommit: z.string().min(1),
      task: input.taskIdentity,
      type: z.literal(type),
      verification: input.verification,
      ...extra,
    })
    .strict();
}

function reviewCompleted(
  input: ReviewSchemaInputs,
  result: z.ZodType,
  type: "plan_compliance_review_completed" | "standards_review_completed",
) {
  return z
    .object({
      result,
      runId: z.string().min(1),
      session: input.agentSession,
      task: input.taskIdentity,
      type: z.literal(type),
    })
    .strict();
}

function reviewInterrupted(
  input: ReviewSchemaInputs,
  type: "plan_compliance_review_interrupted" | "standards_review_interrupted",
  extra: Readonly<Record<string, z.ZodType>> = {},
) {
  return z
    .object({
      attempt: z.number().int().positive(),
      attention: input.runAttention,
      changedPaths: z.array(z.string()),
      completion: input.completion,
      resultCommit: z.string().min(1),
      runId: z.string().min(1),
      session: input.agentSession.nullable(),
      startCommit: z.string().min(1),
      task: input.taskIdentity,
      type: z.literal(type),
      verification: input.verification,
      ...extra,
    })
    .strict();
}

function repairEvent(
  input: ReviewSchemaInputs,
  result: z.ZodType,
  type:
    | "plan_compliance_repair_completed"
    | "plan_compliance_repair_interrupted"
    | "plan_compliance_repair_started"
    | "standards_repair_completed"
    | "standards_repair_interrupted"
    | "standards_repair_started",
  extra: Readonly<Record<string, z.ZodType>> = {},
) {
  return z
    .object({
      result,
      runId: z.string().min(1),
      session: input.agentSession,
      task: input.taskIdentity,
      type: z.literal(type),
      ...extra,
    })
    .strict();
}

export function createRunJournalReviewSchemas(input: ReviewSchemaInputs) {
  const standards = standardsReviewResultSchema;
  const plan = planComplianceReviewResultSchema;
  const standardsField = {
    discoveries: input.discoveries,
    outcomeFacts: input.outcomeFacts,
    standards,
  };
  return {
    planRepairCompleted: repairEvent(
      input,
      plan,
      "plan_compliance_repair_completed",
      { output: z.string() },
    ),
    planRepairInterrupted: repairEvent(
      input,
      plan,
      "plan_compliance_repair_interrupted",
      { attention: input.runAttention },
    ),
    planRepairStarted: repairEvent(
      input,
      plan,
      "plan_compliance_repair_started",
    ),
    planReviewCompleted: reviewCompleted(
      input,
      plan,
      "plan_compliance_review_completed",
    ),
    planReviewInterrupted: reviewInterrupted(
      input,
      "plan_compliance_review_interrupted",
      standardsField,
    ),
    planReviewStarted: reviewStarted(
      input,
      "plan_compliance_review_started",
      standardsField,
    ),
    planState: reviewState(input, plan, standardsField),
    standardsRepairCompleted: repairEvent(
      input,
      standards,
      "standards_repair_completed",
      { output: z.string() },
    ),
    standardsRepairInterrupted: repairEvent(
      input,
      standards,
      "standards_repair_interrupted",
      { attention: input.runAttention },
    ),
    standardsRepairStarted: repairEvent(
      input,
      standards,
      "standards_repair_started",
    ),
    standardsReviewCompleted: reviewCompleted(
      input,
      standards,
      "standards_review_completed",
    ),
    standardsReviewInterrupted: reviewInterrupted(
      input,
      "standards_review_interrupted",
    ),
    standardsReviewStarted: reviewStarted(input, "standards_review_started"),
    standardsState: reviewState(input, standards),
  };
}
