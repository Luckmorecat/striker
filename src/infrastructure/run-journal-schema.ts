import { z } from "zod";

import { reviewResultSchema } from "../review-result-schema.js";

export const legacyRunJournalSchemaId = "striker.plan-journal.v2";
export const runJournalSchemaId = "striker.plan-journal.v3";

const taskIdentitySchema = z
  .object({ id: z.string().min(1), revision: z.string().min(1) })
  .strict();
const agentSessionSchema = z
  .object({ id: z.string().min(1), resumeId: z.string().min(1).optional() })
  .strict();
const verificationSchema = z
  .object({
    command: z.string(),
    exitCode: z.number().int(),
    output: z.string(),
  })
  .strict();
const completionEvidenceSchema = z
  .object({
    summary: z.string(),
    verification: verificationSchema.optional(),
  })
  .strict();
const gitStateSchema = z
  .object({
    dirtyPaths: z.array(z.string()),
    head: z.string(),
    root: z.string(),
    trackedPatch: z.string(),
    untrackedHashes: z.record(z.string(), z.string()),
  })
  .strict();
const taskExecutionSchema = z
  .object({
    affectedPaths: z.array(z.string()),
    cwd: z.string(),
    verifyCommand: z.string(),
    workflowInstructions: z.string(),
  })
  .strict();
const implementationTaskSchema = z.object({
  execution: taskExecutionSchema.optional(),
  identity: taskIdentitySchema,
  instructions: z.string(),
  title: z.string(),
});
const dispatchRequestSchema = z
  .object({
    allowDirty: z.boolean().optional(),
    completedTasks: z.array(taskIdentitySchema),
    planId: z.string().min(1),
    runId: z.string().min(1),
    skills: z.array(z.string()),
    taskSource: z
      .object({ location: z.string(), type: z.string().min(1) })
      .strict(),
  })
  .strict();
const attentionReasonSchema = z.enum([
  "completion_evidence_missing",
  "commit_evidence_missing",
  "dirty_final_state",
  "review_evidence_missing",
  "run_initialization_interrupted",
  "session_resume_failed",
  "standards_repair_interrupted",
  "standards_review_interrupted",
  "verification_failed",
]);
const runAttentionSchema = z
  .object({ detail: z.string(), reason: attentionReasonSchema })
  .strict();
const standardsReviewStateSchema = z
  .object({
    attempt: z.number().int().positive(),
    changedPaths: z.array(z.string()),
    completion: completionEvidenceSchema,
    result: reviewResultSchema.nullable(),
    resultCommit: z.string().min(1),
    repairOutput: z.string().nullable(),
    reviewSession: agentSessionSchema.nullable(),
    stage: z.enum([
      "changes_required",
      "interrupted",
      "passed",
      "repaired",
      "repair_attention",
      "repair_interrupted",
      "repairing",
      "reviewing",
    ]),
    startCommit: z.string().min(1),
    verification: verificationSchema,
  })
  .strict();

export const runSnapshotSchema = z
  .object({
    attempt: z.number().int().positive().optional(),
    attention: runAttentionSchema.nullable().optional(),
    baselineRecorded: z.boolean().optional(),
    before: gitStateSchema.nullable().optional(),
    planId: z.string().min(1),
    request: dispatchRequestSchema,
    runId: z.string().min(1),
    session: agentSessionSchema.nullable(),
    status: z.enum([
      "created",
      "running",
      "needs_attention",
      "failed",
      "completed",
      "discarded",
    ]),
    standardsReview: standardsReviewStateSchema.nullable().optional(),
    task: implementationTaskSchema.nullable(),
  })
  .strict();

const runStartedSchema = z
  .object({
    planId: z.string().min(1),
    request: dispatchRequestSchema,
    runId: z.string().min(1),
    type: z.literal("run_started"),
  })
  .strict();
const taskSelectedSchema = z
  .object({
    runId: z.string().min(1),
    task: implementationTaskSchema,
    type: z.literal("task_selected"),
  })
  .strict();
const taskBaselineRecordedSchema = z
  .object({
    before: gitStateSchema.nullable(),
    runId: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("task_baseline_recorded"),
  })
  .strict();
const taskAttemptStartedSchema = z
  .object({
    attempt: z.number().int().positive(),
    runId: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("task_attempt_started"),
  })
  .strict();
const taskSessionStartedSchema = z
  .object({
    attempt: z.number().int().positive(),
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("task_session_started"),
  })
  .strict();
const runRetriedSchema = z
  .object({
    attempt: z.number().int().nonnegative(),
    runId: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("run_retried"),
  })
  .strict();
const taskCompletedSchema = z
  .object({
    attempt: z.number().int().positive(),
    certification: z.literal("standards_review"),
    changedPaths: z.array(z.string()),
    completedAt: z.iso.datetime(),
    resultCommit: z.string().min(1),
    runId: z.string().min(1),
    session: agentSessionSchema,
    startCommit: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("task_completed"),
    verification: verificationSchema,
  })
  .strict();
const legacyTaskCompletedSchema = taskCompletedSchema
  .omit({ certification: true })
  .transform((event) => ({ ...event, certification: "legacy" as const }));
const standardsReviewStartedSchema = z
  .object({
    attempt: z.number().int().positive(),
    changedPaths: z.array(z.string()),
    completion: completionEvidenceSchema,
    resultCommit: z.string().min(1),
    runId: z.string().min(1),
    session: agentSessionSchema,
    startCommit: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("standards_review_started"),
    verification: verificationSchema,
  })
  .strict();
const standardsReviewCompletedSchema = z
  .object({
    result: reviewResultSchema,
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("standards_review_completed"),
  })
  .strict();
const standardsReviewInterruptedSchema = z
  .object({
    attempt: z.number().int().positive(),
    attention: runAttentionSchema,
    changedPaths: z.array(z.string()),
    completion: completionEvidenceSchema,
    resultCommit: z.string().min(1),
    runId: z.string().min(1),
    session: agentSessionSchema.nullable(),
    startCommit: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("standards_review_interrupted"),
    verification: verificationSchema,
  })
  .strict();
const standardsRepairStartedSchema = z
  .object({
    result: reviewResultSchema,
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("standards_repair_started"),
  })
  .strict();
const standardsRepairInterruptedSchema = z
  .object({
    attention: runAttentionSchema,
    result: reviewResultSchema,
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("standards_repair_interrupted"),
  })
  .strict();
const standardsRepairCompletedSchema = z
  .object({
    output: z.string(),
    result: reviewResultSchema,
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("standards_repair_completed"),
  })
  .strict();
const runNeedsAttentionSchema = z
  .object({
    attention: runAttentionSchema,
    runId: z.string().min(1),
    session: agentSessionSchema.nullable(),
    task: taskIdentitySchema,
    type: z.literal("run_needs_attention"),
  })
  .strict();
const runAnsweredSchema = z
  .object({
    answer: z.string(),
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("run_answered"),
  })
  .strict();
const runResumedSchema = z
  .object({
    attention: runAttentionSchema.optional(),
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("run_resumed"),
  })
  .strict();
const runFailedSchema = z
  .object({
    error: z.string(),
    runId: z.string().min(1),
    session: agentSessionSchema,
    task: taskIdentitySchema,
    type: z.literal("run_failed"),
  })
  .strict();
const runSourceChangedSchema = z
  .object({
    current: taskIdentitySchema.nullable(),
    runId: z.string().min(1),
    task: taskIdentitySchema,
    type: z.literal("run_source_changed"),
  })
  .strict();
const runCompletedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_completed") })
  .strict();
const runDiscardedSchema = z
  .object({ runId: z.string().min(1), type: z.literal("run_discarded") })
  .strict();

export const runJournalEventSchema = z.discriminatedUnion("type", [
  runStartedSchema,
  taskSelectedSchema,
  taskBaselineRecordedSchema,
  taskAttemptStartedSchema,
  taskSessionStartedSchema,
  runRetriedSchema,
  standardsReviewStartedSchema,
  standardsReviewCompletedSchema,
  standardsReviewInterruptedSchema,
  standardsRepairStartedSchema,
  standardsRepairInterruptedSchema,
  standardsRepairCompletedSchema,
  taskCompletedSchema,
  runNeedsAttentionSchema,
  runAnsweredSchema,
  runResumedSchema,
  runFailedSchema,
  runSourceChangedSchema,
  runCompletedSchema,
  runDiscardedSchema,
]);

export const eventEnvelopeSchema = z
  .object({
    event: runJournalEventSchema,
    schema: z.literal(runJournalSchemaId),
  })
  .strict();

export const legacyEventEnvelopeSchema = z
  .object({
    event: z.union([legacyTaskCompletedSchema, runJournalEventSchema]),
    schema: z.literal(legacyRunJournalSchemaId),
  })
  .strict();

export const snapshotEnvelopeSchema = z
  .object({
    eventCount: z.number().int().nonnegative().optional(),
    schema: z.literal(runJournalSchemaId),
    snapshot: runSnapshotSchema,
  })
  .strict();

export const legacySnapshotEnvelopeSchema = snapshotEnvelopeSchema.extend({
  schema: z.literal(legacyRunJournalSchemaId),
});
