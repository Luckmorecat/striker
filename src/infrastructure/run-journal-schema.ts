import { z } from "zod";

import { createRunJournalReviewSchemas } from "./run-journal-review-schema.js";
import {
  discoveryProposalsSchema,
  outcomeFactProposalsSchema,
  resolvedDiscoveryProposalSchema,
  resolvedDiscoveryProposalsSchema,
  resolvedOutcomeFactProposalsSchema,
} from "../discovery-schema.js";
import { discoveryDecisionSchema } from "../review-result-schema.js";
import {
  taskIdentitySchema,
  verificationSchema,
} from "./run-journal-common-schema.js";
import { deliveredOutcomeSchema } from "./run-journal-outcome-schema.js";

export const runJournalSchemaId = "striker.plan-journal.v6";

const agentSessionSchema = z
  .object({ id: z.string().min(1), resumeId: z.string().min(1).optional() })
  .strict();
const agentRequestSchema = z
  .object({
    instructions: z.string(),
    priorTaskEvidence: z.array(deliveredOutcomeSchema).optional(),
    skills: z.array(z.string()),
    workflowInstructions: z.string().optional(),
  })
  .strict();
const completionEvidenceSchema = z
  .object({
    discoveries: discoveryProposalsSchema.optional(),
    outcomeFacts: outcomeFactProposalsSchema.optional(),
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
  outcomePlanId: z.string().min(1).optional(),
  outcomePlanRoutes: z
    .array(
      z
        .object({ from: taskIdentitySchema, to: z.array(taskIdentitySchema) })
        .strict(),
    )
    .optional(),
  outcomeRoutes: z.array(taskIdentitySchema).optional(),
  outcomeTaskOrder: z.array(taskIdentitySchema).optional(),
  outcomeTargets: z
    .array(
      z.object({ contract: z.string(), identity: taskIdentitySchema }).strict(),
    )
    .optional(),
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
  "assumption_disproved",
  "assumption_needs_decision",
  "completion_evidence_missing",
  "commit_evidence_missing",
  "dirty_final_state",
  "plan_compliance_repair_interrupted",
  "plan_compliance_review_interrupted",
  "review_evidence_missing",
  "run_initialization_interrupted",
  "session_resume_failed",
  "standards_repair_interrupted",
  "standards_review_interrupted",
  "task_outcome_conflict",
  "task_outcome_limit_exceeded",
  "verification_failed",
]);
const runAttentionSchema = z
  .object({ detail: z.string(), reason: attentionReasonSchema })
  .strict();
const reviewSchemas = createRunJournalReviewSchemas({
  agentSession: agentSessionSchema,
  completion: completionEvidenceSchema,
  discoveries: resolvedDiscoveryProposalsSchema.default([]),
  outcomeFacts: resolvedOutcomeFactProposalsSchema.default([]),
  runAttention: runAttentionSchema,
  taskIdentity: taskIdentitySchema,
  verification: verificationSchema,
});

export const runSnapshotSchema = z
  .object({
    attempt: z.number().int().positive().optional(),
    attention: runAttentionSchema.nullable().optional(),
    baselineRecorded: z.boolean().optional(),
    before: gitStateSchema.nullable().optional(),
    planId: z.string().min(1),
    planComplianceReview: reviewSchemas.planState.nullable().optional(),
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
    standardsReview: reviewSchemas.standardsState.nullable().optional(),
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
    request: agentRequestSchema,
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
    certification: z.enum(["independent_reviews", "standards_review"]),
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
const assumptionTransitionSchema = z
  .object({
    id: z.string().regex(/^A[1-9]\d*$/u),
    kind: z.literal("assumption"),
    state: z.enum(["confirmed", "disproved", "needs_decision"]),
  })
  .strict();
const defaultTransitionSchema = z
  .object({
    id: z.string().regex(/^D[1-9]\d*$/u),
    kind: z.literal("default"),
    state: z.literal("deviated"),
  })
  .strict();
const ledgerTransitionRecordedSchema = z
  .object({
    decision: discoveryDecisionSchema,
    proposal: resolvedDiscoveryProposalSchema,
    runId: z.string().min(1),
    task: taskIdentitySchema,
    transition: z.discriminatedUnion("kind", [
      assumptionTransitionSchema,
      defaultTransitionSchema,
    ]),
    type: z.literal("ledger_transition_recorded"),
  })
  .strict();
const ledgerAttentionAnsweredSchema = z
  .object({
    answer: z.string().min(1),
    runId: z.string().min(1),
    type: z.literal("ledger_attention_answered"),
  })
  .strict();

export const runJournalEventSchema = z.discriminatedUnion("type", [
  runStartedSchema,
  taskSelectedSchema,
  taskBaselineRecordedSchema,
  taskAttemptStartedSchema,
  taskSessionStartedSchema,
  runRetriedSchema,
  ledgerTransitionRecordedSchema,
  ledgerAttentionAnsweredSchema,
  reviewSchemas.standardsReviewStarted,
  reviewSchemas.standardsReviewCompleted,
  reviewSchemas.standardsReviewInterrupted,
  reviewSchemas.standardsRepairStarted,
  reviewSchemas.standardsRepairInterrupted,
  reviewSchemas.standardsRepairCompleted,
  reviewSchemas.planReviewStarted,
  reviewSchemas.planReviewCompleted,
  reviewSchemas.planReviewInterrupted,
  reviewSchemas.planRepairStarted,
  reviewSchemas.planRepairInterrupted,
  reviewSchemas.planRepairCompleted,
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

export const snapshotEnvelopeSchema = z
  .object({
    eventCount: z.number().int().nonnegative().optional(),
    schema: z.literal(runJournalSchemaId),
    snapshot: runSnapshotSchema,
  })
  .strict();
