import { describe, expect, it } from "vitest";
import { selectHostedWorkspace, selectLocalWorkspace } from "./desktop";

const workspace = (organizationId: string, status: "active" | "invited" | "disabled") => ({
  organizationId,
  membershipEpoch: 1,
  status,
  organization: { name: organizationId },
});

describe("selectHostedWorkspace", () => {
  it("prefers the workspace the user connected on this desktop", () => {
    const chosen = selectHostedWorkspace(
      [workspace("org-a", "active"), workspace("org-b", "active")],
      "org-b",
      ["org-a"],
    );
    expect(chosen?.organizationId).toBe("org-b");
  });

  it("falls back to the workspace that already has a local replica", () => {
    const chosen = selectHostedWorkspace(
      [workspace("org-b", "active"), workspace("org-a", "active")],
      "org-gone",
      ["org-a"],
    );
    expect(chosen?.organizationId).toBe("org-a");
  });

  it("ignores memberships that are not active", () => {
    const chosen = selectHostedWorkspace(
      [workspace("org-invited", "invited"), workspace("org-disabled", "disabled")],
      null,
      [],
    );
    expect(chosen).toBeNull();
  });

  it("does not open a disabled workspace just because it is remembered", () => {
    const chosen = selectHostedWorkspace(
      [workspace("org-remembered", "disabled"), workspace("org-active", "active")],
      "org-remembered",
      ["org-remembered"],
    );
    expect(chosen?.organizationId).toBe("org-active");
  });
});

describe("selectLocalWorkspace", () => {
  it("keeps the remembered replica when it exists", () => {
    expect(selectLocalWorkspace("org-b", ["org-a", "org-b"])).toBe("org-b");
  });

  it("falls back to the first replica when the remembered one is gone", () => {
    expect(selectLocalWorkspace("org-gone", ["org-a"])).toBe("org-a");
  });

  it("returns null when no replica has ever been configured", () => {
    expect(selectLocalWorkspace(null, [])).toBeNull();
  });
});
