import { describe, expect, test } from "bun:test";
import { parseYoutubeVideoId } from "./youtube-url";

describe("parseYoutubeVideoId", () => {
  test("rejects non-YouTube and invalid ids", () => {
    expect(
      parseYoutubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ")
    ).toBeNull();
    expect(
      parseYoutubeVideoId("https://www.youtube.com/watch?v=short")
    ).toBeNull();
    expect(parseYoutubeVideoId("not a url")).toBeNull();
    expect(parseYoutubeVideoId(undefined)).toBeNull();
  });
});
