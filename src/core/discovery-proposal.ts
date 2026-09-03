import type {
  CodeDiscoveryLocator,
  DiscoveryLocator,
  DiscoveryProposal,
  ResolvedDiscoveryProposal,
  VerificationDiscoveryLocator,
} from "./discovery-contracts.js";

export interface DiscoveryExecutionEvidence {
  readonly after: { readonly head: string; readonly root: string };
  readonly verification: {
    readonly command: string;
    readonly exitCode: number;
    readonly output: string;
  };
}

export interface DiscoveryEvidenceRepository {
  readFileAtCommit?(
    root: string,
    commit: string,
    path: string,
  ): Promise<string | null>;
}

async function resolveCodeLocator(
  locator: CodeDiscoveryLocator,
  execution: DiscoveryExecutionEvidence,
  git: DiscoveryEvidenceRepository | undefined,
): Promise<CodeDiscoveryLocator & { readonly commit: string }> {
  if (git?.readFileAtCommit === undefined) {
    throw new Error("Code discovery evidence requires Git access");
  }
  const commit = execution.after.head;
  const content = await git.readFileAtCommit(
    execution.after.root,
    commit,
    locator.path,
  );
  const actual = content?.split(/\r?\n/u)[locator.line - 1];
  if (actual === undefined || actual !== locator.text) {
    throw new Error(
      `Discovery code locator does not match candidate: ${locator.path}:${String(locator.line)}`,
    );
  }
  return { ...locator, commit };
}

function resolveVerificationLocator(
  locator: VerificationDiscoveryLocator,
  execution: DiscoveryExecutionEvidence,
): VerificationDiscoveryLocator {
  const verification = execution.verification;
  if (
    locator.command !== verification.command ||
    locator.exitCode !== verification.exitCode ||
    !verification.output.includes(locator.output)
  ) {
    throw new Error(
      "Discovery verification locator does not match stored verification",
    );
  }
  return locator;
}

export function resolveDiscoveryLocator(
  locator: DiscoveryLocator,
  execution: DiscoveryExecutionEvidence,
  git: DiscoveryEvidenceRepository | undefined,
): Promise<ResolvedDiscoveryProposal["locator"]> {
  return locator.kind === "code"
    ? resolveCodeLocator(locator, execution, git)
    : Promise.resolve(resolveVerificationLocator(locator, execution));
}

export async function resolveDiscoveryProposals(
  proposals: readonly DiscoveryProposal[],
  execution: DiscoveryExecutionEvidence,
  git: DiscoveryEvidenceRepository | undefined,
): Promise<readonly ResolvedDiscoveryProposal[]> {
  return Promise.all(
    proposals.map(async (proposal) => ({
      ...proposal,
      locator: await resolveDiscoveryLocator(proposal.locator, execution, git),
    })),
  );
}
