import { describe, expect, test } from "bun:test";
import {
  formatSubAgentSubtitle,
  parseSubAgentResult,
  splitToolResultImages,
} from "./chat-stream";

describe("sub_agent chat formatting", () => {
  test("formatSubAgentSubtitle surfaces timeout and fail", () => {
    expect(
      formatSubAgentSubtitle(
        { task: "Research" },
        {
          error: "Sub-agent timed out.",
          output: "",
          status: "timeout",
          summary: "",
        },
        false
      )
    ).toBe("Sub-agent timed out.");

    expect(
      formatSubAgentSubtitle(
        { task: "Research" },
        {
          error: "Nested not allowed.",
          output: "",
          status: "fail",
          summary: "",
        },
        false
      )
    ).toBe("Nested not allowed.");
  });

  test("parseSubAgentResult rejects malformed payloads", () => {
    expect(parseSubAgentResult(null)).toBeNull();
    expect(parseSubAgentResult({ summary: "x" })).toBeNull();
  });
});

describe("splitToolResultImages", () => {
  test("pulls image content out and keeps text", () => {
    expect(
      splitToolResultImages({
        content: [
          { data: "aGk=", mimeType: "image/png", type: "image" },
          { text: "Saved", type: "text" },
        ],
      })
    ).toEqual({
      images: [{ data: "aGk=", mimeType: "image/png" }],
      rest: "Saved",
    });
  });

  test("drops server image stubs and keeps text", () => {
    expect(
      splitToolResultImages({
        content: [
          { mimeType: "image/png", type: "image" },
          { text: "Saved", type: "text" },
        ],
      })
    ).toEqual({ images: [], rest: "Saved" });
  });

  test("leaves results without images unchanged", () => {
    const result = { content: [{ text: "ok", type: "text" }] };
    expect(splitToolResultImages(result)).toEqual({ images: [], rest: result });
  });

  test("ignores non-image mime types", () => {
    expect(
      splitToolResultImages({
        content: [{ data: "x", mimeType: "text/html", type: "image" }],
      }).images
    ).toEqual([]);
  });
});
