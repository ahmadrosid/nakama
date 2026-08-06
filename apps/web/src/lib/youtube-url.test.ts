import { describe, expect, test } from "bun:test";
import { parseYoutubeVideoId, youtubeEmbedSrc } from "./youtube-url";

describe("parseYoutubeVideoId", () => {
  test("parses watch URLs", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseYoutubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&t=30")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  test("parses youtu.be share links", () => {
    expect(parseYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).toBe("dQw4w9WgXcQ");
  });

  test("parses embed, shorts, and live paths", () => {
    expect(parseYoutubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(parseYoutubeVideoId("https://www.youtube.com/live/dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
  });

  test("rejects non-YouTube and invalid ids", () => {
    expect(parseYoutubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(parseYoutubeVideoId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYoutubeVideoId("not a url")).toBeNull();
    expect(parseYoutubeVideoId(undefined)).toBeNull();
  });
});

describe("youtubeEmbedSrc", () => {
  test("builds a nocookie embed URL", () => {
    expect(youtubeEmbedSrc("dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });
});
