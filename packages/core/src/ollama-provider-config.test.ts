import { describe, expect, test } from "bun:test";
import {
  isOllamaCloudBaseUrl,
  resolveOllamaHostMode,
} from "./ollama-provider-config";

describe("isOllamaCloudBaseUrl", () => {
  test("matches the ollama.com host only", () => {
    expect(isOllamaCloudBaseUrl("https://ollama.com/v1")).toBe(true);
    expect(isOllamaCloudBaseUrl("https://api.ollama.com")).toBe(true);
    expect(isOllamaCloudBaseUrl("https://evil.test/?ollama.com")).toBe(false);
    expect(isOllamaCloudBaseUrl("https://ollama.com.evil.test")).toBe(false);
    expect(isOllamaCloudBaseUrl("not a url")).toBe(false);
  });

  test("a local URL that names ollama.com in its path stays local", () => {
    expect(
      resolveOllamaHostMode({ baseUrl: "http://localhost:11434/ollama.com" })
    ).toBe("local");
  });
});
