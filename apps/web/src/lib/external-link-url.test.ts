import { describe, expect, test } from "bun:test";
import { splitExternalUrl } from "./external-link-url";

describe("splitExternalUrl", () => {
  test("highlights host between protocol and path", () => {
    expect(splitExternalUrl("https://bit.ly/4poxClj")).toEqual({
      host: "bit.ly",
      prefix: "https://",
      suffix: "/4poxClj",
    });
  });

  test("keeps query and hash in the suffix", () => {
    expect(splitExternalUrl("https://example.com/path?q=1#top")).toEqual({
      host: "example.com",
      prefix: "https://",
      suffix: "/path?q=1#top",
    });
  });

  test("falls back to the raw string when parsing fails", () => {
    expect(splitExternalUrl("not a url")).toEqual({
      host: "not a url",
      prefix: "",
      suffix: "",
    });
  });
});
