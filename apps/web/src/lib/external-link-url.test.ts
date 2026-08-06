import { describe, expect, test } from "bun:test";
import { splitExternalUrl } from "./external-link-url";

describe("splitExternalUrl", () => {
  test("highlights host between protocol and path", () => {
    expect(splitExternalUrl("https://bit.ly/4poxClj")).toEqual({
      prefix: "https://",
      host: "bit.ly",
      suffix: "/4poxClj",
    });
  });

  test("keeps query and hash in the suffix", () => {
    expect(splitExternalUrl("https://example.com/path?q=1#top")).toEqual({
      prefix: "https://",
      host: "example.com",
      suffix: "/path?q=1#top",
    });
  });

  test("falls back to the raw string when parsing fails", () => {
    expect(splitExternalUrl("not a url")).toEqual({
      prefix: "",
      host: "not a url",
      suffix: "",
    });
  });
});
