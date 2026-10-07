import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ChannelOrgStore,
  findOrgBySelectionInput,
  formatOrgSelectionPrompt,
  prepareChannelOrgContext,
} from "./channel-org";
import type { UserOrgSummary } from "./contract";

const orgs: UserOrgSummary[] = [
  {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "org_a",
    name: "Acme",
    role: "admin",
    slug: "acme",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "org_b",
    name: "Beta",
    role: "member",
    slug: "beta",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("findOrgBySelectionInput", () => {
  test("matches list index", () => {
    expect(findOrgBySelectionInput("2", orgs)?.id).toBe("org_b");
  });

  test("matches slug", () => {
    expect(findOrgBySelectionInput("acme", orgs)?.id).toBe("org_a");
  });
});

describe("prepareChannelOrgContext", () => {
  test("auto-selects when only one org exists", async () => {
    let saved: string | undefined;

    const result = await prepareChannelOrgContext({
      getSelectedOrgId: () => undefined,
      listOrgs: async () => ({ orgs: [orgs[0]!] }),
      saveSelectedOrgId: async (orgId) => {
        saved = orgId;
      },
    });

    expect(result).toEqual({
      orgId: "org_a",
      orgName: "Acme",
      status: "ready",
    });
    expect(saved).toBe("org_a");
  });

  test("prompts when the stored org is gone and one other remains", async () => {
    let saved: string | undefined;

    const result = await prepareChannelOrgContext({
      getSelectedOrgId: () => "org_archived",
      listOrgs: async () => ({ orgs: [orgs[0]!] }),
      saveSelectedOrgId: async (orgId) => {
        saved = orgId;
      },
    });

    expect(result.status).toBe("prompt");
    expect(saved).toBeUndefined();
  });

  test("prompts when multiple orgs and nothing stored", async () => {
    const result = await prepareChannelOrgContext({
      getSelectedOrgId: () => undefined,
      listOrgs: async () => ({ orgs }),
      saveSelectedOrgId: async () => {},
    });

    expect(result.status).toBe("prompt");
    if (result.status === "prompt") {
      expect(result.message).toBe(formatOrgSelectionPrompt(orgs));
    }
  });

  test("accepts numeric selection replies", async () => {
    let saved: string | undefined;

    const result = await prepareChannelOrgContext({
      getSelectedOrgId: () => undefined,
      listOrgs: async () => ({ orgs }),
      saveSelectedOrgId: async (orgId) => {
        saved = orgId;
      },
      text: "2",
    });

    expect(result).toEqual({
      justSelected: true,
      orgId: "org_b",
      orgName: "Beta",
      status: "ready",
    });
    expect(saved).toBe("org_b");
  });
});

describe("ChannelOrgStore", () => {
  test("a slow save does not land after a newer one", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nakama-org-store-"));
    const filePath = path.join(dir, "org-selection.json");
    try {
      const store = new ChannelOrgStore(filePath);
      // Big enough that this snapshot is still being written when the next
      // save, a few bytes long, has already been renamed into place.
      store.set("user_a", "x".repeat(16_000_000));
      const first = store.save();
      store.delete("user_a");
      store.set("user_b", "org_b");
      await Promise.all([first, store.save()]);

      const reloaded = new ChannelOrgStore(filePath);
      await reloaded.load();
      expect(reloaded.get("user_b")?.orgId).toBe("org_b");
      expect(reloaded.get("user_a")).toBeUndefined();
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
