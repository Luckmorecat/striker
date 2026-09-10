export class AnswerCancelled extends Error {
  constructor(readonly exitCode: 0 | 130) {
    super("Run left paused.");
  }
}
