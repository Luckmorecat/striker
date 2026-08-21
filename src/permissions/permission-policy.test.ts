import { describe, expect, it } from "vitest";

import { permissionPolicyFor } from "./permission-policy.js";

describe("permission policy", () => {
  it("relays attended permission requests", () => {
    expect(permissionPolicyFor("attended")).toEqual({
      acpxPermissionMode: "approve-reads",
      nonInteractivePermissions: "fail",
      relayRequests: true,
    });
  });

  it("uses acpx approve-all only for unattended mode", () => {
    expect(permissionPolicyFor("unattended")).toEqual({
      acpxPermissionMode: "approve-all",
      nonInteractivePermissions: "fail",
      relayRequests: false,
    });
  });

  it("keeps Codex sandboxed while routing approvals to auto-review", () => {
    expect(permissionPolicyFor("auto-review")).toEqual({
      acpxPermissionMode: "approve-reads",
      nonInteractivePermissions: "fail",
      relayRequests: false,
      requiredHarness: "codex",
      sessionEnvironment: {
        CODEX_CONFIG:
          '{"approval_policy":"on-request","approvals_reviewer":"auto_review","sandbox_mode":"workspace-write"}',
      },
    });
  });
});
