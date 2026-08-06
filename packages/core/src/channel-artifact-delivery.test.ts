import { describe, expect, test } from "bun:test";
import {
  formatArtifactShareFooter,
  isAttachIntent,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
  resolveShareUrlForPublish,
} from "./channel-artifact-delivery";

describe("isAttachIntent", () => {
  test("matches common attach phrases", () => {
    expect(isAttachIntent("send me the file")).toBe(true);
    expect(isAttachIntent("attach it")).toBe(true);
    expect(isAttachIntent("/attach")).toBe(true);
  });

  test("does not match unrelated text", () => {
    expect(isAttachIntent("thanks")).toBe(false);
    expect(isAttachIntent("save a report")).toBe(false);
  });
});

describe("resolveShareUrlForPublish", () => {
  test("stores first publish URL in cache", () => {
    const cache: Record<string, string> = {};

    const resolved = resolveShareUrlForPublish(
      {
        shareUrl: "https://app.example/s/tok_1",
        sharePath: "/s/tok_1",
        webPublicUrlConfigured: true,
        refreshed: false,
      },
      cache,
      "report.md",
    );

    expect(resolved.shareUrl).toBe("https://app.example/s/tok_1");
    expect(cache["report.md"]).toBe("https://app.example/s/tok_1");
  });

  test("reuses cached URL on refresh", () => {
    const cache: Record<string, string> = {
      "report.md": "https://app.example/s/tok_1",
    };

    const resolved = resolveShareUrlForPublish(
      {
        shareUrl: null,
        sharePath: "",
        webPublicUrlConfigured: true,
        refreshed: true,
      },
      cache,
      "report.md",
    );

    expect(resolved.shareUrl).toBe("https://app.example/s/tok_1");
  });
});

describe("formatArtifactShareFooter", () => {
  test("formats absolute links", () => {
    expect(
      formatArtifactShareFooter(
        [{ filename: "report.md", shareUrl: "https://app.example/s/tok_1", sharePath: "/s/tok_1" }],
        { webPublicUrlConfigured: true },
      ),
    ).toBe("report.md: https://app.example/s/tok_1");
  });

  test("adds hint when public URL is not configured", () => {
    expect(
      formatArtifactShareFooter(
        [{ filename: "report.md", shareUrl: null, sharePath: "/s/tok_1" }],
        { webPublicUrlConfigured: false },
      ),
    ).toContain("Set Web Public URL");
  });
});

describe("mintDeliverableArtifacts", () => {
  test("skips artifacts when publish fails", async () => {
    const delivered = await mintDeliverableArtifacts({
      artifacts: [
        {
          filename: "report.md",
          path: "report.md",
          mimeType: "text/markdown",
          sizeBytes: 1,
          savedAt: "2026-07-13T10:00:00.000Z",
        },
      ],
      shareUrlCache: {},
      publish: async () => {
        throw new Error("publish failed");
      },
    });

    expect(delivered).toEqual([]);
  });
});

describe("pushDeliverableArtifact", () => {
  test("keeps most recent entries bounded", () => {
    const base = {
      mimeType: "text/plain",
      sizeBytes: 1,
      savedAt: "2026-07-13T10:00:00.000Z",
      shareUrl: "https://example/s/a",
      sharePath: "/s/a",
    };

    let registry = pushDeliverableArtifact([], { ...base, filename: "a.md", path: "a.md" }, 2);
    registry = pushDeliverableArtifact(registry, { ...base, filename: "b.md", path: "b.md" }, 2);
    registry = pushDeliverableArtifact(registry, { ...base, filename: "c.md", path: "c.md" }, 2);

    expect(registry.map((entry) => entry.path)).toEqual(["b.md", "c.md"]);
  });
});
