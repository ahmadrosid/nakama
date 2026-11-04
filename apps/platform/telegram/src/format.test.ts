import { describe, expect, test } from "bun:test";
import { prepareTelegramFallbackReply } from "./format";

describe("prepareTelegramFallbackReply", () => {
  test("preserves legacy share tokens with underscores in bare URLs", () => {
    const shareUrl =
      "http://127.0.0.1:4310/s/tc_share_a7e24436b9bd4ec8bd60edba6d403c74f0b19596f27b440db85d7f171299bbdc";

    const footer =
      `context-engineering-slides.html: ${shareUrl}\n` +
      "Set Web Public URL in Nakama settings for absolute share links.";

    expect(prepareTelegramFallbackReply(footer)).toBe(footer);
    expect(prepareTelegramFallbackReply(footer)).toContain("tc_share_");
    expect(prepareTelegramFallbackReply(footer)).not.toContain("/s/tcshare");
  });

  test("preserves dollar replacement sequences in bare URLs", () => {
    const url = "https://example.com/$&/path";

    expect(prepareTelegramFallbackReply(url)).toBe(url);
  });

  test("still strips italic markers outside URLs", () => {
    expect(
      prepareTelegramFallbackReply("see _share_ then https://example.com/a_b")
    ).toBe("see share then https://example.com/a_b");
  });
});

describe("prepareTelegramFallbackReply plain text", () => {
  test("keeps snake case and strips strike and spoiler markers", () => {
    expect(
      prepareTelegramFallbackReply("Set active_org_id, ~~old~~ and ||secret||")
    ).toBe("Set active_org_id, old and secret");
  });

  test("converts tables and keeps empty cells intact", () => {
    expect(
      prepareTelegramFallbackReply(
        "| Name | A | B |\n|---|---|---|\n| x || y |"
      )
    ).toBe("x\n• B: y");
  });

  test("shows link urls and unescapes html", () => {
    expect(
      prepareTelegramFallbackReply("[docs](https://x.dev/a?b=1&c=2) <tag>")
    ).toBe("docs (https://x.dev/a?b=1&c=2) <tag>");
  });
});
