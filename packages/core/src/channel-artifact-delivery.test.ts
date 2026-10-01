import { describe, expect, test } from "bun:test";
import {
  deliverTurnArtifactShares,
  formatArtifactShareFooter,
  isAttachIntent,
  isAttachOnlyCommand,
  isFreshReportRequest,
  mintDeliverableArtifacts,
  pushDeliverableArtifact,
  resolveArtifactForAttach,
  resolveShareUrlForPublish,
} from "./channel-artifact-delivery";
import type { ChatMessage } from "./contract";

describe("isAttachIntent", () => {
  test("matches common attach phrases", () => {
    expect(isAttachIntent("send me the file")).toBe(true);
    expect(isAttachIntent("attach it")).toBe(true);
    expect(isAttachIntent("/attach")).toBe(true);
    expect(isAttachIntent("send the pdf")).toBe(true);
    expect(isAttachIntent("send me the csv")).toBe(true);
    expect(isAttachIntent("attach the image")).toBe(true);
    expect(isAttachIntent("send nakama-pitch-deck.pdf")).toBe(true);
    expect(isAttachIntent("tolong kirim csv file kesini please")).toBe(true);
    expect(
      isAttachIntent(
        "collect the report from 01-09-2026 to 06-09-2026 in csv file then send it to this group"
      )
    ).toBe(true);
  });

  test("does not match unrelated text", () => {
    expect(isAttachIntent("thanks")).toBe(false);
    expect(isAttachIntent("save a report")).toBe(false);
    expect(isAttachIntent("jangan kirim csv ke grup")).toBe(false);
    expect(isAttachIntent("tidak usah kirimkan file")).toBe(false);
  });
});

describe("isFreshReportRequest", () => {
  test("matches time-bound report requests in both languages", () => {
    expect(isFreshReportRequest("tolong kirim laporan harian")).toBe(true);
    expect(isFreshReportRequest("send today's report")).toBe(true);
    expect(isFreshReportRequest("kirim laporan terbaru")).toBe(true);
    expect(isFreshReportRequest("buatkan laporan hari ini")).toBe(true);
  });

  test.each([
    "kirim laporan bulanan",
    "send the report monthly",
    "kirim laporan dari 01-09-2026 sampai 27-09-2026",
    "send the report from 2026-09-01 to 2026-09-27",
    "send the report from 01/09/2026 to 27/09/2026",
    "kirim laporan 01.09.2026 sampai 27.09.2026",
    "send the report from 2026.09.01 to 2026.09.27",
    "send the report for September 1 to 27, 2026",
    "kirim laporan dari 1 sampai 27 September 2026",
    "kirim laporan dari 1 Agustus sampai 2 Oktober 2026",
    "send the report from 1st Sep. to 27th Sep. 2026",
    "send the report from September 1st to 27th, 2026",
    "send the report from Sep. 1st to 27th, 2026",
    "send the report from September 2nd to 27th, 2026",
    "send the report from September 3rd to 27th, 2026",
    "send the report from September 4th to 27th, 2026",
    "kirim laporan dalam 1 file .csv",
    "kirim laporan dalam satu file",
    "send the report in one CSV",
    "send the report as a single file",
  ])("routes report constraints to the agent: %s", (text) => {
    expect(isFreshReportRequest(text)).toBe(true);
  });

  test("does not match plain attach or thanks", () => {
    expect(isFreshReportRequest("kirim file rekap-well-test.csv")).toBe(false);
    expect(isFreshReportRequest("send me the file")).toBe(false);
    expect(isFreshReportRequest("thanks")).toBe(false);
    expect(isFreshReportRequest("")).toBe(false);
  });

  test("ignores markers that only appear inside a filename", () => {
    expect(isFreshReportRequest("kirim file daily-report.csv")).toBe(false);
    expect(isFreshReportRequest("send me update-harga.csv")).toBe(false);
    expect(isFreshReportRequest("kirim file laporan-terbaru.csv")).toBe(false);
    expect(isFreshReportRequest("send me the latest-report.pdf")).toBe(false);
    expect(isFreshReportRequest("kirim file laporan-bulanan.csv")).toBe(false);
    expect(isFreshReportRequest("send report-2026-09-01.csv")).toBe(false);
    expect(isFreshReportRequest("send report-01.09.2026.csv")).toBe(false);
    expect(isFreshReportRequest('send file "September 1 to 27.csv"')).toBe(
      false
    );
    expect(
      isFreshReportRequest('send file "01.09.2026.csv" for September 1 to 27')
    ).toBe(true);
    expect(isFreshReportRequest('send file "monthly report.csv"')).toBe(false);
    expect(isFreshReportRequest("kirim file 'laporan bulanan.csv'")).toBe(
      false
    );
    expect(isFreshReportRequest("send file `monthly report.csv`")).toBe(false);
    expect(
      isFreshReportRequest('send file "monthly report.csv" in one file')
    ).toBe(true);
    expect(isFreshReportRequest("send monthly-report.csv in one file")).toBe(
      true
    );
  });

  test.each([
    { expected: false, text: "send file monthly report.csv" },
    { expected: false, text: "send file Monthly Report.csv" },
    { expected: false, text: "send file September 1st to 27th.csv" },
    { expected: false, text: "send file monthly report (1).csv, please" },
    { expected: true, text: "send file monthly report.csv in one file" },
    {
      expected: true,
      text: "send file monthly report.csv for September 1st to 27th",
    },
    {
      expected: true,
      text: "send file Monthly Report.csv for September 1st to 27th",
    },
    { expected: true, text: "send the latest monthly report.csv" },
    { expected: true, text: "send file monthly report.csv.bak" },
    { expected: true, text: "send file monthly invoice.csv" },
  ])(
    "checks constraints outside saved filenames: $text",
    ({ text, expected }) => {
      expect(
        isFreshReportRequest(text, [
          "report.csv",
          "monthly report.csv",
          "September 1st to 27th.csv",
          "monthly report (1).csv",
        ])
      ).toBe(expected);
    }
  );
});

describe("isAttachOnlyCommand", () => {
  test("matches /attach shortcuts", () => {
    expect(isAttachOnlyCommand("/attach")).toBe(true);
    expect(isAttachOnlyCommand("/attach@bot")).toBe(true);
    expect(isAttachOnlyCommand("send me the file")).toBe(false);
  });
});

describe("resolveArtifactForAttach", () => {
  test("prefers registry over listed artifacts", () => {
    const artifact = resolveArtifactForAttach({
      listed: [
        {
          filename: "listed.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          updatedAt: "2026-08-08T12:00:00.000Z",
        },
      ],
      registry: [
        {
          filename: "registry.md",
          mimeType: "text/markdown",
          path: "registry.md",
          savedAt: "2026-08-08T11:00:00.000Z",
          sharePath: null,
          shareUrl: null,
          sizeBytes: 5,
        },
      ],
    });

    expect(artifact?.path).toBe("registry.md");
  });

  test("falls back to newest listed artifact when registry is empty", () => {
    const artifact = resolveArtifactForAttach({
      listed: [
        {
          filename: "nakama-pitch-deck.pdf",
          mimeType: "application/pdf",
          sizeBytes: 272_153,
          updatedAt: "2026-08-08T12:51:00.000Z",
        },
        {
          filename: "older.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          updatedAt: "2026-08-07T12:00:00.000Z",
        },
      ],
      registry: [],
    });

    expect(artifact?.filename).toBe("nakama-pitch-deck.pdf");
    expect(artifact?.path).toBe("nakama-pitch-deck.pdf");
  });
});

describe("resolveShareUrlForPublish", () => {
  test("stores first publish URL in cache", () => {
    const cache: Record<string, string> = {};

    const resolved = resolveShareUrlForPublish(
      {
        refreshed: false,
        sharePath: "/s/tok_1",
        shareUrl: "https://app.example/s/tok_1",
        webPublicUrlConfigured: true,
      },
      cache,
      "report.md"
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
        refreshed: true,
        sharePath: "",
        shareUrl: null,
        webPublicUrlConfigured: true,
      },
      cache,
      "report.md"
    );

    expect(resolved.shareUrl).toBe("https://app.example/s/tok_1");
  });
});

describe("formatArtifactShareFooter", () => {
  test("formats absolute links", () => {
    expect(
      formatArtifactShareFooter(
        [
          {
            filename: "report.md",
            sharePath: "/s/tok_1",
            shareUrl: "https://app.example/s/tok_1",
          },
        ],
        { webPublicUrlConfigured: true }
      )
    ).toBe("report.md: https://app.example/s/tok_1");
  });

  test("adds hint when public URL is not configured", () => {
    expect(
      formatArtifactShareFooter(
        [{ filename: "report.md", sharePath: "/s/tok_1", shareUrl: null }],
        { webPublicUrlConfigured: false }
      )
    ).toContain("Set Web Public URL");
  });
});

describe("mintDeliverableArtifacts", () => {
  test("skips artifacts when publish fails", async () => {
    const delivered = await mintDeliverableArtifacts({
      artifacts: [
        {
          filename: "report.md",
          mimeType: "text/markdown",
          path: "report.md",
          savedAt: "2026-07-13T10:00:00.000Z",
          sizeBytes: 1,
        },
      ],
      publish: async () => {
        throw new Error("publish failed");
      },
      shareUrlCache: {},
    });

    expect(delivered).toEqual([]);
  });
});

describe("pushDeliverableArtifact", () => {
  test("keeps most recent entries bounded", () => {
    const base = {
      mimeType: "text/plain",
      savedAt: "2026-07-13T10:00:00.000Z",
      sharePath: "/s/a",
      shareUrl: "https://example/s/a",
      sizeBytes: 1,
    };

    let registry = pushDeliverableArtifact(
      [],
      { ...base, filename: "a.md", path: "a.md" },
      2
    );
    registry = pushDeliverableArtifact(
      registry,
      { ...base, filename: "b.md", path: "b.md" },
      2
    );
    registry = pushDeliverableArtifact(
      registry,
      { ...base, filename: "c.md", path: "c.md" },
      2
    );

    expect(registry.map((entry) => entry.path)).toEqual(["b.md", "c.md"]);
  });
});

describe("deliverTurnArtifactShares", () => {
  test("mints shares, updates session store, and sends footer", async () => {
    const artifactsRoot =
      "/Users/test/.nakama/orgs/org_1/profiles/profile_1/artifacts";
    const metaJson = JSON.stringify({
      mimeType: "text/markdown",
      savedAt: "2026-07-13T10:00:00.000Z",
      sizeBytes: 42,
    });
    const scratchMeta = JSON.stringify({
      mimeType: "application/json",
      savedAt: "2026-07-13T10:00:01.000Z",
      sizeBytes: 2,
    });
    const messages: ChatMessage[] = [
      { content: "save report", role: "user" },
      {
        content: "",
        role: "assistant",
        toolCalls: [
          {
            arguments: { content: "# Report", path: "artifacts/report.md" },
            id: "tool_1",
            name: "write_file",
          },
          {
            arguments: {
              content: metaJson,
              path: "artifacts/report.md.nakama-meta.json",
            },
            id: "tool_2",
            name: "write_file",
          },
          {
            arguments: { content: "{}", path: "artifacts/_scratch-debug.json" },
            id: "tool_3",
            name: "write_file",
          },
          {
            arguments: {
              content: scratchMeta,
              path: "artifacts/_scratch-debug.json.nakama-meta.json",
            },
            id: "tool_4",
            name: "write_file",
          },
        ],
      },
      {
        content: JSON.stringify({
          bytesWritten: 8,
          path: `${artifactsRoot}/report.md`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_1",
      },
      {
        content: JSON.stringify({
          bytesWritten: metaJson.length,
          path: `${artifactsRoot}/report.md.nakama-meta.json`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_2",
      },
      {
        content: JSON.stringify({
          bytesWritten: 2,
          path: `${artifactsRoot}/_scratch-debug.json`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_3",
      },
      {
        content: JSON.stringify({
          bytesWritten: scratchMeta.length,
          path: `${artifactsRoot}/_scratch-debug.json.nakama-meta.json`,
        }),
        name: "write_file",
        role: "tool",
        toolCallId: "tool_4",
      },
      { content: "Saved the report.", role: "assistant" },
    ];

    const shareUrls: Record<string, string> = {};
    let registry: Array<{
      filename: string;
      mimeType: string;
      path: string;
      savedAt: string;
      sharePath: string;
      shareUrl: string | null;
      sizeBytes: number;
    }> = [];
    let saved = false;
    const footers: string[] = [];
    const published: string[] = [];

    const delivered = await deliverTurnArtifactShares({
      conversationKey: "chat:1",
      publish: async (path) => {
        published.push(path);
        return {
          refreshed: false,
          sharePath: "/s/tok_1",
          shareUrl: "https://app.example/s/tok_1",
          webPublicUrlConfigured: true,
        };
      },
      sendFooter: async (footer) => {
        footers.push(footer);
      },
      session: {
        getMessages: async () => messages,
      },
      sessionStore: {
        getArtifactShareUrls: () => shareUrls,
        getDeliverableArtifacts: () => registry,
        save: async () => {
          saved = true;
        },
        updateArtifactState: (_key, update) => {
          if (update.artifactShareUrls) {
            Object.assign(shareUrls, update.artifactShareUrls);
          }
          if (update.deliverableArtifacts) {
            registry = update.deliverableArtifacts;
          }
        },
      },
    });

    expect(delivered).toEqual([
      {
        filename: "report.md",
        mimeType: "text/markdown",
        path: "report.md",
        savedAt: "2026-07-13T10:00:00.000Z",
        sharePath: "/s/tok_1",
        shareUrl: "https://app.example/s/tok_1",
        sizeBytes: 42,
      },
    ]);
    expect(saved).toBe(true);
    expect(published).toEqual(["report.md"]);
    expect(registry.map((entry) => entry.path)).toEqual(["report.md"]);
    expect(footers.join("\n")).not.toContain("_scratch-debug.json");
    expect(footers).toEqual(["report.md: https://app.example/s/tok_1"]);
  });

  test("returns empty when the turn has no paired artifacts", async () => {
    const delivered = await deliverTurnArtifactShares({
      conversationKey: "chat:empty",
      publish: async () => {
        throw new Error("should not publish");
      },
      sendFooter: async () => {
        throw new Error("should not send footer");
      },
      session: {
        getMessages: async () => [{ content: "hi", role: "user" }],
      },
      sessionStore: {
        getArtifactShareUrls: () => ({}),
        getDeliverableArtifacts: () => [],
        save: async () => undefined,
        updateArtifactState: () => undefined,
      },
    });

    expect(delivered).toEqual([]);
  });
});
