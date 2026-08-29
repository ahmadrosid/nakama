import { afterEach, describe, expect, test } from "bun:test";
import {
  MARKDOWN_EXTERNAL_LINK_FEATURES,
  openMarkdownExternalLink,
} from "./markdown-external-link";

describe("openMarkdownExternalLink", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
      writable: true,
    });
  });

  test("includes noopener in window features", () => {
    expect(MARKDOWN_EXTERNAL_LINK_FEATURES.split(",")).toContain("noopener");
    expect(MARKDOWN_EXTERNAL_LINK_FEATURES.split(",")).toContain("noreferrer");
  });

  test("opens with _blank and noopener,noreferrer features", () => {
    const calls: unknown[][] = [];
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        open: (...args: unknown[]) => {
          calls.push(args);
          return null;
        },
      },
      writable: true,
    });

    openMarkdownExternalLink("https://evil.example/phish");

    expect(calls).toEqual([
      ["https://evil.example/phish", "_blank", "noopener,noreferrer"],
    ]);
  });
});
