import { z } from "zod";
import {
  agentRequestSchema,
  agentSessionSchema,
  gitStateSchema,
} from "../../infrastructure/run-journal-schema.js";
import { verificationSchema } from "../../infrastructure/run-journal-common-schema.js";
import { reviewResultSchema } from "../../review-result-schema.js";
import { activityTextLimit } from "../visible-activity.js";

export const maximumFrameBytes = 16 * 1024 * 1024;
const idSchema = z.uuid();
const commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const range = { ancestor: commit, descendant: commit };
const base = z.object({ id: idSchema });
export const workerRequestSchema = z.discriminatedUnion("operation", [
  base.extend({ operation: z.literal("inspect") }).strict(),
  base.extend({ operation: z.literal("isAncestor"), ...range }).strict(),
  base.extend({ operation: z.literal("commitsBetween"), ...range }).strict(),
  base.extend({ operation: z.literal("changedPaths"), ...range }).strict(),
  base
    .extend({
      operation: z.literal("readFileAtCommit"),
      commit,
      path: z.string().min(1),
    })
    .strict(),
  base
    .extend({ operation: z.literal("verify"), command: z.string().min(1) })
    .strict(),
  base
    .extend({ operation: z.literal("implement"), request: agentRequestSchema })
    .strict(),
  base
    .extend({ operation: z.literal("review"), instructions: z.string() })
    .strict(),
  base
    .extend({
      operation: z.literal("continue"),
      session: agentSessionSchema,
      instructions: z.string(),
    })
    .strict(),
]);
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
export type WorkerRequest = DeepReadonly<z.infer<typeof workerRequestSchema>>;
export type WorkerOperation = WorkerRequest["operation"];
const failed = z
  .object({
    status: z.literal("failed"),
    session: agentSessionSchema,
    error: z.string(),
  })
  .strict();
const turn = z.discriminatedUnion("status", [
  failed,
  z
    .object({
      status: z.literal("returned"),
      session: agentSessionSchema,
      output: z.string(),
    })
    .strict(),
]);
const reviewTurn = z.discriminatedUnion("status", [
  failed,
  z
    .object({
      status: z.literal("returned"),
      session: agentSessionSchema,
      result: reviewResultSchema,
    })
    .strict(),
]);
const resultSchemas = {
  inspect: gitStateSchema,
  isAncestor: z.boolean(),
  commitsBetween: z.array(commit),
  changedPaths: z.array(z.string()),
  readFileAtCommit: z.string().nullable(),
  verify: verificationSchema,
  implement: turn,
  continue: turn,
  review: reviewTurn,
};
function parseFrame(frame: string): unknown {
  if (Buffer.byteLength(frame) > maximumFrameBytes)
    throw new Error("Worker frame exceeds limit");
  return JSON.parse(frame) as unknown;
}
export function parseWorkerRequest(frame: string): WorkerRequest {
  return workerRequestSchema.parse(parseFrame(frame));
}
/** Ephemeral display text only: never a session, a result or a transcript. */
export const workerActivitySchema = z
  .object({
    type: z.literal("activity"),
    activity: z.enum(["note", "tool"]),
    text: z.string().min(1).max(activityTextLimit),
  })
  .strict();
export type WorkerActivity = DeepReadonly<z.infer<typeof workerActivitySchema>>;

export function parseWorkerResponse(
  frame: string,
  id: string,
  operation: WorkerOperation,
) {
  return z
    .discriminatedUnion("type", [
      z
        .object({
          id: z.literal(id),
          type: z.literal("started"),
          session: agentSessionSchema,
        })
        .strict(),
      workerActivitySchema.extend({ id: z.literal(id) }).strict(),
      z
        .object({
          id: z.literal(id),
          type: z.literal("error"),
          message: z.string(),
        })
        .strict(),
      z
        .object({
          id: z.literal(id),
          type: z.literal("result"),
          value: resultSchemas[operation],
        })
        .strict(),
    ])
    .parse(parseFrame(frame));
}
