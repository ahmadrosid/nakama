import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { OrgMemoryService } from "../services/org-memory-service";
import { createOrgMemoryTools } from "./org-memory-tools";

function context(orgId: string, orgRole?: ToolContext["orgRole"]): ToolContext {
  return { orgId, orgRole };
}

describe("org memory tools", () => {
  test("org_memory_search as member returns matching bullets", async () => {
    const service = new OrgMemoryService();
    const spy = spyOnSearch(service, "org_a", "Bun");
    const [searchTool] = createOrgMemoryTools(service);
    const result = await searchTool.run(
      { query: "Bun" },
      context("org_a", "member")
    );
    expect(result).toEqual({
      matches: [{ bullet: "we use Bun", source: "live", tier: "pinned" }],
      query: "Bun",
    });
    expect(spy.orgId).toBe("org_a");
    expect(spy.query).toBe("Bun");
  });

  test("org_memory_search as viewer throws", async () => {
    const service = new OrgMemoryService();
    const [searchTool] = createOrgMemoryTools(service);
    await expect(
      searchTool.run({ query: "x" }, context("org_a", "viewer"))
    ).rejects.toThrow("Viewers cannot access org memory.");
  });

  test("org_memory_search with undefined orgRole throws (deny-by-default)", async () => {
    const service = new OrgMemoryService();
    const [searchTool] = createOrgMemoryTools(service);
    await expect(
      searchTool.run({ query: "x" }, context("org_a", undefined))
    ).rejects.toThrow("organization role");
  });

  test("org_memory_search with missing orgId throws", async () => {
    const service = new OrgMemoryService();
    const [searchTool] = createOrgMemoryTools(service);
    await expect(
      searchTool.run({ query: "x" }, { orgRole: "member" })
    ).rejects.toThrow("Organization context is required.");
  });

  test("org_memory_search with empty query throws", async () => {
    const service = new OrgMemoryService();
    const [searchTool] = createOrgMemoryTools(service);
    await expect(
      searchTool.run({ query: "  " }, context("org_a", "member"))
    ).rejects.toThrow("query is required.");
  });

  test("org_memory_list as member returns live content", async () => {
    const service = new OrgMemoryService();
    const listTool = createOrgMemoryTools(service)[1];
    const result = await listTool.run({}, context("org_a", "member"));
    expect(result).toHaveProperty("content");
  });

  test("propose_org_memory as member creates a proposal", async () => {
    const service = new OrgMemoryService(createInMemoryDatabaseAdapter());
    const proposeTool = createOrgMemoryTools(service)[2];
    const result = await proposeTool.run(
      { bullet: "standups are at 10am UTC" },
      {
        ...context("org_a", "member"),
        profileId: "profile_1",
        sessionId: "session_1",
        userId: "user_1",
      }
    );
    expect(result.outcome).toBe("created");
  });

  test("propose_org_memory as viewer throws", async () => {
    const service = new OrgMemoryService(createInMemoryDatabaseAdapter());
    const proposeTool = createOrgMemoryTools(service)[2];
    await expect(
      proposeTool.run({ bullet: "fact" }, context("org_a", "viewer"))
    ).rejects.toThrow("Viewers cannot access org memory.");
  });
});

function spyOnSearch(
  service: OrgMemoryService,
  expectedOrgId: string,
  expectedQuery: string
): { orgId: string; query: string } {
  const captured = { orgId: "", query: "" };
  service.search = (async (orgId: string, query: string) => {
    captured.orgId = orgId;
    captured.query = query;
    return {
      matches: [
        { bullet: "we use Bun", source: "live", tier: "pinned" as const },
      ],
      query,
    };
  }) as OrgMemoryService["search"];
  void expectedOrgId;
  void expectedQuery;
  return captured;
}
