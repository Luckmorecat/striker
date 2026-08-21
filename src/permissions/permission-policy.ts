import type { AgentHarness, ApprovalMode } from "../core/contracts.js";

export interface PermissionPolicy {
  readonly acpxPermissionMode: "approve-all" | "approve-reads";
  readonly nonInteractivePermissions: "fail";
  readonly relayRequests: boolean;
  readonly requiredHarness?: AgentHarness;
  readonly sessionEnvironment?: Readonly<Record<string, string>>;
}

const policies: Readonly<Record<ApprovalMode, PermissionPolicy>> = {
  attended: {
    acpxPermissionMode: "approve-reads",
    nonInteractivePermissions: "fail",
    relayRequests: true,
  },
  "auto-review": {
    acpxPermissionMode: "approve-reads",
    nonInteractivePermissions: "fail",
    relayRequests: false,
    requiredHarness: "codex",
    sessionEnvironment: {
      CODEX_CONFIG: JSON.stringify({
        approval_policy: "on-request",
        approvals_reviewer: "auto_review",
        sandbox_mode: "workspace-write",
      }),
    },
  },
  unattended: {
    acpxPermissionMode: "approve-all",
    nonInteractivePermissions: "fail",
    relayRequests: false,
  },
};

export function permissionPolicyFor(mode: ApprovalMode): PermissionPolicy {
  return policies[mode];
}
