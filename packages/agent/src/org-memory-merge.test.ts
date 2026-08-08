import { describe, expect, test } from "bun:test";
import { ORG_MEMORY_PREAMBLE, type ProviderClient } from "@nakama/core";
import {
  mergeOrgMemoryWithApprovedBullet,
  mergeOrgMemoryWithApprovedBulletFallback,
} from "./org-memory-merge";

describe("mergeOrgMemoryWithApprovedBullet", () => {
  test("returns null without provider", async () => {
    const result = await mergeOrgMemoryWithApprovedBullet(
      `${ORG_MEMORY_PREAMBLE}\n`,
      "Team standups are at 10am UTC",
      { pin: true }
    );
    expect(result).toBeNull();
  });

  test("returns normalized provider output when valid", async () => {
    const provider: ProviderClient = {
      async generateChat() {
        throw new Error("not used");
      },
      async generateText() {
        return {
          content: `${ORG_MEMORY_PREAMBLE}\n\n- Team standups are at 10am UTC\n`,
        };
      },
      async streamChat() {
        throw new Error("not used");
      },
    };

    const result = await mergeOrgMemoryWithApprovedBullet(
      `${ORG_MEMORY_PREAMBLE}\n\n- Team standups are at 9am UTC\n`,
      "Team standups are at 10am UTC",
      { pin: true, provider }
    );

    expect(result).toBe(
      "## Org Memory\n\n## Pinned\n\n- Team standups are at 10am UTC\n"
    );
  });

  test("returns null when provider output omits the approved bullet", async () => {
    const provider: ProviderClient = {
      async generateChat() {
        throw new Error("not used");
      },
      async generateText() {
        return {
          content: `${ORG_MEMORY_PREAMBLE}\n\n- unrelated fact\n`,
        };
      },
      async streamChat() {
        throw new Error("not used");
      },
    };

    const result = await mergeOrgMemoryWithApprovedBullet(
      `${ORG_MEMORY_PREAMBLE}\n`,
      "Team standups are at 10am UTC",
      { pin: true, provider }
    );

    expect(result).toBeNull();
  });
});

describe("mergeOrgMemoryWithApprovedBulletFallback", () => {
  test("replaces superseded facts mechanically", () => {
    const result = mergeOrgMemoryWithApprovedBulletFallback(
      `${ORG_MEMORY_PREAMBLE}\n\n- Team standups are at 9am UTC\n`,
      "Team standups are at 10am UTC",
      { pin: true }
    );

    expect(result).toContain("- Team standups are at 10am UTC");
    expect(result).not.toContain("9am UTC");
  });
});
