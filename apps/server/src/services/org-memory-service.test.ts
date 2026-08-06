import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { ORG_MEMORY_PREAMBLE, parseOrgMemoryContent } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { OrgMemoryService } from "./org-memory-service";

describe("OrgMemoryService", () => {
  let tempDir = "";

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function setup(withDb = false): Promise<OrgMemoryService> {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "nakama-org-memory-"));
    return new OrgMemoryService(
      withDb ? createInMemoryDatabaseAdapter() : null,
      { configDir: tempDir },
    );
  }

  test("getMemory returns the canonical preamble when the file is missing", async () => {
    const service = await setup();
    const content = await service.getMemory("org_a");
    expect(content).toBe(`${ORG_MEMORY_PREAMBLE}\n`);
  });

  test("addFact with pin creates MEMORY.md with preamble + bullet on first action", async () => {
    const service = await setup();
    await service.addFact("org_a", "deploys ship on Tuesdays", { pin: true });
    const content = await service.getMemory("org_a");
    const parsed = parseOrgMemoryContent(content);
    expect(parsed.pinned).toEqual(["deploys ship on Tuesdays"]);
    expect(content).toContain("## Org Memory");
    expect(content).toContain("## Pinned");
  });

  test("addFact is idempotent for an already-pinned bullet", async () => {
    const service = await setup();
    await service.addFact("org_a", "fact one", { pin: true });
    await service.addFact("org_a", "fact one", { pin: true });
    const parsed = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(parsed.pinned).toEqual(["fact one"]);
  });

  test("getSummary returns the pinned bullets", async () => {
    const service = await setup();
    await service.addFact("org_a", "fact one", { pin: true });
    await service.addFact("org_a", "fact two", { pin: true });
    const summary = await service.getSummary("org_a");
    expect(summary).toContain("## Org Memory");
    expect(summary).toContain("- fact one");
    expect(summary).toContain("- fact two");
  });

  test("unpinFact removes a pinned bullet; 404 when not pinned", async () => {
    const service = await setup();
    await service.addFact("org_a", "fact one", { pin: true });
    await service.unpinFact("org_a", "fact one");
    const parsed = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(parsed.pinned).toEqual([]);
    await expect(service.unpinFact("org_a", "missing")).rejects.toThrow("Pinned fact not found.");
  });

  test("setMemory replaces live content and rejects oversized bodies", async () => {
    const service = await setup();
    await service.setMemory("org_a", `${ORG_MEMORY_PREAMBLE}\n\n- custom\n`);
    expect(await service.getMemory("org_a")).toContain("- custom");
    const huge = "x".repeat(10_000);
    await expect(service.setMemory("org_a", huge)).rejects.toThrow("size limit");
  });

  test("search finds bullets in the live file and archive files", async () => {
    const service = await setup();
    await service.addFact("org_a", "we use Bun not Node", { pin: true });
    await service.addFact("org_a", "deploys on Tuesday", { pin: true });
    const result = await service.search("org_a", "Bun");
    expect(result.matches.some((m) => m.bullet.includes("Bun"))).toBe(true);
    expect(result.matches.some((m) => m.bullet.includes("Tuesday"))).toBe(false);
  });

  test("archiveEntries moves bullets to memory-archive", async () => {
    const service = await setup();
    await service.addFact("org_a", "stale fact", { pin: true });
    await service.addFact("org_a", "keep fact", { pin: true });
    const result = await service.archiveEntries("org_a", ["stale fact"]);
    expect(result.archived).toBe(1);
    const parsed = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(parsed.pinned).toEqual(["keep fact"]);
  });

  test("cross-org isolation: addFact to org_a only writes org_a's dir", async () => {
    const service = await setup();
    await service.addFact("org_a", "org a fact", { pin: true });
    const orgB = await service.getMemory("org_b");
    expect(orgB).toBe(`${ORG_MEMORY_PREAMBLE}\n`);
    const orgA = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(orgA.pinned).toEqual(["org a fact"]);
  });

  test("propose creates pending row without writing MEMORY.md", async () => {
    const service = await setup(true);
    const result = await service.propose("org_a", { bullet: "team standup is 10am UTC" });
    expect(result.outcome).toBe("created");
    expect(result.proposalId).toBeTruthy();
    const memory = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(memory.pinned).toEqual([]);
    expect(memory.sections).toEqual([]);
    const pending = await service.listProposals("org_a", "pending");
    expect(pending).toHaveLength(1);
  });

  test("propose returns already_pending for duplicate bullet", async () => {
    const service = await setup(true);
    const first = await service.propose("org_a", { bullet: "shared deploy window" });
    const second = await service.propose("org_a", { bullet: "shared deploy window" });
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("already_pending");
    expect(await service.countPendingProposals("org_a")).toBe(1);
  });

  test("approve writes to recent-log section by default", async () => {
    const service = await setup(true);
    const proposed = await service.propose("org_a", { bullet: "review PRs before lunch" });
    await service.approveProposal("org_a", proposed.proposalId!, "admin_user");
    const parsed = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(parsed.pinned).toEqual([]);
    expect(parsed.sections.some((section) => section.bullets.includes("review PRs before lunch"))).toBe(
      true,
    );
  });

  test("approve with pin writes to pinned section and is idempotent", async () => {
    const service = await setup(true);
    const proposed = await service.propose("org_a", { bullet: "always pin this" });
    await service.approveProposal("org_a", proposed.proposalId!, "admin_user", { pin: true });
    await service.approveProposal("org_a", proposed.proposalId!, "admin_user", { pin: true });
    const parsed = parseOrgMemoryContent(await service.getMemory("org_a"));
    expect(parsed.pinned.filter((bullet) => bullet === "always pin this")).toEqual(["always pin this"]);
  });

  test("search tags pinned and recent-log tiers", async () => {
    const service = await setup();
    await service.addFact("org_a", "pinned fact", { pin: true });
    await service.addRecentLogFact("org_a", "dated fact", "2026-07-31");
    const result = await service.search("org_a", "fact");
    expect(result.matches.some((match) => match.tier === "pinned")).toBe(true);
    expect(result.matches.some((match) => match.tier === "recent-log" && match.date === "2026-07-31")).toBe(
      true,
    );
  });

  test("logs changes and supports undo", async () => {
    const service = await setup();
    await service.setMemory("org_a", `${ORG_MEMORY_PREAMBLE}\n\n- first fact\n`, {
      actorUserId: "admin_user",
      action: "edit",
      label: "Initial edit",
    });
    await service.setMemory("org_a", `${ORG_MEMORY_PREAMBLE}\n\n- second fact\n`, {
      actorUserId: "admin_user",
      action: "edit",
      label: "Second edit",
    });

    const history = await service.listHistory("org_a");
    expect(history).toHaveLength(2);
    expect(history[0]?.label).toBe("Second edit");

    const restored = await service.undoLastChange("org_a", "admin_user");
    expect(restored).toContain("- first fact");
    expect(await service.getMemory("org_a")).toContain("- first fact");
    expect((await service.listHistory("org_a"))).toHaveLength(3);

    const latest = (await service.listHistory("org_a"))[0]!;
    const revision = await service.getHistoryRevision("org_a", latest.id);
    expect(revision.content).toContain("- first fact");
    expect(revision.change.id).toBe(latest.id);
  });
});
