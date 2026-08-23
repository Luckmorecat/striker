export interface CodeDiscoveryLocator {
  readonly kind: "code";
  readonly line: number;
  readonly path: string;
  readonly text: string;
}

export interface VerificationDiscoveryLocator {
  readonly command: string;
  readonly exitCode: number;
  readonly kind: "verification";
  readonly output: string;
}

export type DiscoveryLocator =
  CodeDiscoveryLocator | VerificationDiscoveryLocator;

export type DiscoveryProposal =
  | {
      readonly id: string;
      readonly kind: "assumption";
      readonly locator: DiscoveryLocator;
      readonly reason: string;
      readonly state: "confirmed" | "disproved" | "needs_decision";
    }
  | {
      readonly deviation: string;
      readonly id: string;
      readonly kind: "default";
      readonly locator: DiscoveryLocator;
    };

export type ResolvedDiscoveryProposal = DiscoveryProposal & {
  readonly locator:
    | (CodeDiscoveryLocator & { readonly commit: string })
    | VerificationDiscoveryLocator;
};
