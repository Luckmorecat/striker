export const reviewEvidenceMarker =
  'STRIKER_REVIEWS {"standards":"passed","plan":"passed"}';

export const reviewEvidenceInstructions = `After both review passes and all checks succeed, end the response with this exact machine-readable line:\n\n${reviewEvidenceMarker}`;

export function hasReviewEvidence(agentOutput: string): boolean {
  return agentOutput.trimEnd().split(/\r?\n/u).at(-1) === reviewEvidenceMarker;
}
