/** What the operator gave the paused run: a decision, or a deliberate exit. */
export type AnswerInput =
  | { readonly status: "submitted"; readonly text: string }
  | { readonly status: "cancelled"; readonly exitCode: 0 | 130 };
