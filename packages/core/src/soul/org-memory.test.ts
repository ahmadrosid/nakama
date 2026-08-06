import { afterEach, describe, expect, test } from "bun:test";
import {
  appendOrgMemorySection,
  applyApprovedOrgMemoryBullet,
  composeOrgMemorySummary,
  ORG_MEMORY_PREAMBLE,
  parseOrgMemoryContent,
  previewOrgMemoryAfterApprove,
  rebuildOrgMemoryContent,
} from "./org-memory";

describe("org memory parse/rebuild", () => {
  test("parses a pinned-only MEMORY.md", () => {
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- deploys ship on Tuesdays\n- prefer Bun over Node\n`;
    const parsed = parseOrgMemoryContent(content);
    expect(parsed.preamble).toBe("## Org Memory");
    expect(parsed.pinned).toEqual(["deploys ship on Tuesdays", "prefer Bun over Node"]);
    expect(parsed.sections).toEqual([]);
  });

  test("round-trips parse -> rebuild -> equal", () => {
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- deploys ship on Tuesdays\n- prefer Bun over Node\n`;
    const rebuilt = rebuildOrgMemoryContent(parseOrgMemoryContent(content));
    expect(rebuilt).toBe(content);
  });

  test("round-trips pinned and dated sections", () => {
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- pinned fact\n\n## 2026-07-25\n\n- dated fact\n`;
    const rebuilt = rebuildOrgMemoryContent(parseOrgMemoryContent(content));
    expect(rebuilt).toBe(content);
  });

  test("rebuild adds the preamble when missing", () => {
    const rebuilt = rebuildOrgMemoryContent({ preamble: "", pinned: ["a fact"], sections: [] });
    expect(rebuilt).toBe("## Org Memory\n\n## Pinned\n\n- a fact\n");
  });

  test("rebuild does not duplicate the pinned header", () => {
    const rebuilt = rebuildOrgMemoryContent(
      parseOrgMemoryContent("## Pinned\n\n- fact\n"),
    );
    expect(rebuilt).toBe("## Org Memory\n\n## Pinned\n\n- fact\n");
    expect((rebuilt.match(/^## Pinned$/gm) ?? []).length).toBe(1);
  });

  test("applyApprovedOrgMemoryBullet replaces superseded pinned facts", () => {
    const live = `${ORG_MEMORY_PREAMBLE}\n\n- Team standups are at 9am UTC\n`;
    const next = applyApprovedOrgMemoryBullet(live, "Team standups are at 10am UTC", {
      pin: true,
    });
    const parsed = parseOrgMemoryContent(next);
    expect(parsed.pinned).toEqual(["Team standups are at 10am UTC"]);
    expect((next.match(/^## Pinned$/gm) ?? []).length).toBe(1);
  });

  test("empty/missing MEMORY.md yields empty summary (no throw)", () => {
    expect(composeOrgMemorySummary("")).toBe("");
    expect(composeOrgMemorySummary(ORG_MEMORY_PREAMBLE)).toBe("");
    expect(composeOrgMemorySummary(null)).toBe("");
    expect(parseOrgMemoryContent(undefined).pinned).toEqual([]);
  });

  test("includes dated sections in summary", () => {
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- pinned fact\n\n## 2026-07-25\n\n- dated fact\n`;
    const parsed = parseOrgMemoryContent(content);
    expect(parsed.pinned).toEqual(["pinned fact"]);
    expect(parsed.sections).toEqual([{ date: "2026-07-25", bullets: ["dated fact"] }]);
    const summary = composeOrgMemorySummary(content);
    expect(summary).toContain("- pinned fact");
    expect(summary).toContain("- dated fact");
  });
});

describe("composeOrgMemorySummary", () => {
  test("returns header + pinned bullets", () => {
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- fact one\n- fact two\n`;
    const summary = composeOrgMemorySummary(content);
    expect(summary).toContain("## Org Memory");
    expect(summary).toContain("- fact one");
    expect(summary).toContain("- fact two");
  });

  test("includes recent log bullets up to recentLogLimit", () => {
    const dated = Array.from({ length: 25 }, (_, i) => `## 2026-07-${String(i + 1).padStart(2, "0")}\n\n- fact ${i}`);
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- pinned\n\n${dated.join("\n\n")}\n`;
    const summary = composeOrgMemorySummary(content, { recentLogLimit: 20, byteCap: 4096 });
    expect(summary).toContain("- pinned");
    const recentMatches = summary.match(/^- fact \d+$/gm) ?? [];
    expect(recentMatches.length).toBeLessThanOrEqual(20);
  });

  test("truncates at byte cap and appends overflow hint", () => {
    const bullets = Array.from({ length: 50 }, (_, i) => `fact number ${i} with some text`);
    const content = `${ORG_MEMORY_PREAMBLE}\n\n${bullets.map((b) => `- ${b}`).join("\n")}\n`;
    const summary = composeOrgMemorySummary(content, { byteCap: 256 });
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(512);
    expect(summary).toContain("org_memory_search");
    expect(summary).not.toContain("fact number 49");
  });

  test("emits header + hint when even one bullet exceeds the cap", () => {
    const huge = "x".repeat(3000);
    const content = `${ORG_MEMORY_PREAMBLE}\n\n- ${huge}\n`;
    const summary = composeOrgMemorySummary(content, { byteCap: 256 });
    expect(summary).toContain("## Org Memory");
    expect(summary).toContain("org_memory_search");
    expect(summary).not.toContain(huge);
  });
});

describe("appendOrgMemorySection", () => {
  const base = "# Identity\n\nYou are helpful.";

  test("appends the summary for a member", () => {
    const summary = "## Org Memory\n\n- fact one";
    expect(appendOrgMemorySection(base, summary, "member")).toBe(
      `${base}\n\n${summary}`,
    );
  });

  test("appends the summary for an admin", () => {
    const summary = "## Org Memory\n\n- fact one";
    expect(appendOrgMemorySection(base, summary, "admin")).toBe(
      `${base}\n\n${summary}`,
    );
  });

  test("appends the summary when orgRole is undefined (system runners)", () => {
    const summary = "## Org Memory\n\n- fact one";
    expect(appendOrgMemorySection(base, summary, undefined)).toBe(
      `${base}\n\n${summary}`,
    );
  });

  test("does NOT append for a viewer", () => {
    const summary = "## Org Memory\n\n- secret fact";
    expect(appendOrgMemorySection(base, summary, "viewer")).toBe(base);
  });

  test("does not append an empty summary (no empty header)", () => {
    expect(appendOrgMemorySection(base, "", "member")).toBe(base);
    expect(appendOrgMemorySection(base, "   \n  ", "member")).toBe(base);
  });
});

describe("previewOrgMemoryAfterApprove", () => {
  const live = `${ORG_MEMORY_PREAMBLE}\n\n- existing pinned fact\n`;

  test("recent-log approve preview includes bullet in prompt injection", () => {
    const preview = previewOrgMemoryAfterApprove(live, "team standups are at 10am UTC", {
      pin: false,
      dateUtc: "2026-07-31",
    });
    expect(preview.destination).toBe("recent-log");
    expect(preview.destinationLabel).toBe("## 2026-07-31");
    expect(preview.memoryLine).toBe("- team standups are at 10am UTC");
    expect(preview.promptInjection).toContain("- existing pinned fact");
    expect(preview.promptInjection).toContain("- team standups are at 10am UTC");
  });

  test("pinned approve preview places bullet after existing pinned facts", () => {
    const preview = previewOrgMemoryAfterApprove(live, "new pinned fact", { pin: true });
    expect(preview.destination).toBe("pinned");
    expect(preview.destinationLabel).toBe("## Pinned");
    expect(preview.promptInjection).toContain("- new pinned fact");
  });
});
